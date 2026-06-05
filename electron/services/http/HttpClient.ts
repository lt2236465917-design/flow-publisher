import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { logger } from '../../utils/logger'
import { Agent as HttpsAgent } from 'https'
import { getAccountRepository, saveDatabase } from '../database'

const DEFAULT_TIMEOUT = 30_000
const UPLOAD_TIMEOUT = 300_000

export interface CookieContext {
  cookies: string
  platform: string
  accountId: string
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
  url: string
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'arraybuffer' | 'blob' | 'text'
  onUploadProgress?: (progress: { loaded: number; total: number; percent: number }) => void
  noCookie?: boolean
  /** When true, only send explicitly provided headers + Cookie (no browser-like defaults) */
  minimalHeaders?: boolean
}

export interface ApiResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
}

// 2026年最新的Edge浏览器版本 - 保持与真实用户一致
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'

// Browser-like headers matching real Edge 136 browser
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': REALISTIC_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip,deflate,br',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
  Connection: 'keep-alive',
  'sec-ch-ua': '"Microsoft Edge";v="136", "Chromium";v="136", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
}

const HTTPS_AGENT = new HttpsAgent({ rejectUnauthorized: false })

export class HttpClient {
  private context: CookieContext

  constructor(context: CookieContext) {
    this.context = context
  }

  getCookieString(): string {
    return this.context.cookies
  }

  getAccountId(): string {
    return this.context.accountId
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<ApiResponse<T>> {
    const baseHeaders = options.minimalHeaders
      ? { Accept: 'application/json, text/plain, */*' }
      : BROWSER_HEADERS
    const config: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      data: options.data,
      params: options.params,
      adapter: 'http',
      httpsAgent: HTTPS_AGENT,
      headers: {
        ...baseHeaders,
        ...(options.noCookie ? {} : { Cookie: this.context.cookies }),
        ...options.headers
      },
      timeout: options.timeout || DEFAULT_TIMEOUT,
      responseType: options.responseType || 'json',
      // Accept all non-negative status codes — callers check status manually.
      // This is intentional: platform adapters handle 401/403 as session expiry gracefully.
      validateStatus: (status) => status >= 0 && status < 800,
      onUploadProgress: options.onUploadProgress
        ? (event) => {
            options.onUploadProgress!({
              loaded: event.loaded,
              total: event.total || 0,
              percent: event.total ? Math.round((event.loaded / event.total) * 100) : 0
            })
          }
        : undefined
    }

    try {
      // Log the actual request for debugging
      logger.info(`[HttpClient] ${options.method} ${options.url}`)
      // Log headers without Cookie value to avoid credential leakage
      const safeHeaders: Record<string, unknown> = { ...config.headers }
      if (safeHeaders['Cookie']) safeHeaders['Cookie'] = `*** (${String(safeHeaders['Cookie']).length} chars)`
      logger.info(`[HttpClient] Headers: ${JSON.stringify(safeHeaders)}`)
      if (typeof options.data === 'string') {
        logger.info(`[HttpClient] Body (string, first 3000): ${options.data.substring(0, 3000)}`)
      }

      const response: AxiosResponse<T> = await axios(config)

      logger.info(`[HttpClient] Response: status=${response.status}, url=${response.request?.res?.responseUrl || response.config?.url || 'unknown'}`)

      // Refresh cookies from Set-Cookie response headers
      this.refreshCookiesFromResponse(response)

      return {
        status: response.status,
        data: response.data,
        headers: response.headers as Record<string, string>
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        const data = err.response?.data
        logger.error(`[${this.context.platform}] HTTP ${options.method} ${options.url} failed: ${status}`, data)
        throw new Error(`HTTP ${options.method} ${options.url} failed: ${status} ${JSON.stringify(data)}`)
      }
      throw err
    }
  }

  /**
   * Extract Set-Cookie headers from response and update cookies in database.
   * This keeps cookies fresh across API calls without re-login.
   */
  private refreshCookiesFromResponse(response: AxiosResponse): void {
    try {
      const setCookies = response.headers['set-cookie']
      if (!setCookies || setCookies.length === 0) return

      // Parse current cookies into a map
      const cookieMap = new Map<string, string>()
      for (const part of this.context.cookies.split(';')) {
        const [name, ...rest] = part.trim().split('=')
        if (name && rest.length > 0) {
          cookieMap.set(name.trim(), rest.join('='))
        }
      }

      // Merge new cookies from Set-Cookie headers
      let updated = false
      for (const sc of setCookies) {
        const [nameValue] = sc.split(';')
        const [name, ...rest] = nameValue.split('=')
        if (name && rest.length > 0) {
          const cookieName = name.trim()
          const cookieValue = rest.join('=')
          // Skip expired cookies
          if (cookieValue === '' || cookieValue === 'deleted') {
            if (cookieMap.has(cookieName)) {
              cookieMap.delete(cookieName)
              updated = true
            }
          } else {
            cookieMap.set(cookieName, cookieValue)
            updated = true
          }
        }
      }

      if (!updated) return

      // Rebuild cookie string
      const newCookieStr = Array.from(cookieMap.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      this.context.cookies = newCookieStr

      // Save to database
      if (this.context.accountId) {
        const repo = getAccountRepository()
        const account = repo.getById(this.context.accountId)
        if (account) {
          // Update the stored cookie JSON with new values
          let storedCookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }> = []
          try {
            storedCookies = JSON.parse(account.cookies || '[]')
          } catch { /* ignore */ }

          // Merge new cookies into stored cookies
          for (const sc of setCookies) {
            const parts = sc.split(';').map(s => s.trim())
            const [nameValue] = parts
            const [name, ...rest] = nameValue.split('=')
            if (!name || rest.length === 0) continue

            const cookieName = name.trim()
            const cookieValue = rest.join('=')

            // Parse cookie attributes from Set-Cookie
            const attrs: Record<string, string> = {}
            for (let i = 1; i < parts.length; i++) {
              const [attrName, ...attrRest] = parts[i].split('=')
              attrs[attrName.toLowerCase()] = attrRest.join('=') || 'true'
            }

            const existingIdx = storedCookies.findIndex(c => c.name === cookieName)
            const cookieObj = {
              name: cookieName,
              value: cookieValue,
              domain: attrs.domain || response.request?.host || '',
              path: attrs.path || '/',
              expires: attrs.expires ? Math.floor(new Date(attrs.expires).getTime() / 1000) : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
              httpOnly: attrs.httponly === 'true',
              secure: attrs.secure === 'true',
              sameSite: (attrs.samesite as string) || 'Lax'
            }

            if (cookieValue === '' || cookieValue === 'deleted') {
              if (existingIdx >= 0) storedCookies.splice(existingIdx, 1)
            } else if (existingIdx >= 0) {
              storedCookies[existingIdx] = cookieObj
            } else {
              storedCookies.push(cookieObj)
            }
          }

          repo.updateSession(this.context.accountId, 'logged_in', JSON.stringify(storedCookies))
          saveDatabase()
          logger.info(`[HttpClient] Cookies refreshed from Set-Cookie: ${setCookies.length} headers, total: ${storedCookies.length} cookies`)
        }
      }
    } catch (e) {
      // Cookie refresh is non-fatal
      logger.warn('[HttpClient] Failed to refresh cookies from response:', e)
    }
  }

  async get<T = unknown>(
    url: string,
    params?: Record<string, unknown>,
    headers?: Record<string, string>,
    noCookie?: boolean
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ method: 'GET', url, params, headers, noCookie })
  }

  async head<T = unknown>(
    url: string,
    headers?: Record<string, string>,
    noCookie?: boolean
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ method: 'HEAD', url, headers, noCookie })
  }

  async post<T = unknown>(
    url: string,
    data?: unknown,
    headers?: Record<string, string>,
    options?: Partial<HttpRequestOptions>
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ method: 'POST', url, data, headers, ...options })
  }

  /**
   * POST with minimal headers (no browser-like defaults).
   * Use for APIs that are sensitive to extra headers (e.g., WeChat Channels location API).
   */
  async postMinimal<T = unknown>(
    url: string,
    data?: unknown,
    headers?: Record<string, string>,
    options?: Partial<HttpRequestOptions>
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ method: 'POST', url, data, headers, minimalHeaders: true, ...options })
  }

  async uploadFile<T = unknown>(
    url: string,
    formData: unknown, // Accept both Web FormData and Node form-data
    headers?: Record<string, string>,
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
  ): Promise<ApiResponse<T>> {
    return this.request<T>({
      method: 'POST',
      url,
      data: formData,
      headers: {
        ...headers
      },
      timeout: UPLOAD_TIMEOUT,
      onUploadProgress: onProgress
    })
  }
}
