import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { logger } from '../../utils/logger'
import { getAccountRepository, saveDatabase } from '../database'
import { encryptString, decryptString } from '../../utils/crypto-store'

const DEFAULT_TIMEOUT = 30_000
const UPLOAD_TIMEOUT = 300_000

/** Callback invoked when Set-Cookie response headers update the cookie store */
export type CookieRefreshCallback = (
  accountId: string,
  cookies: string,
  platform: string
) => void

export interface CookieContext {
  cookies: string
  platform: string
  accountId: string
  /** Optional callback for cookie persistence — decouples HttpClient from DB (M13 fix) */
  onCookiesRefreshed?: CookieRefreshCallback
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

const SENSITIVE_LOG_HEADERS = new Set([
  'authorization',
  'bd-ticket-guard-client-data',
  'bd-ticket-guard-ree-public-key',
  'cookie',
  'proxy-authorization',
  'x-secsdk-csrf-token'
])

function summarizeData(data: unknown, maxLength = 1000): string {
  if (data === undefined || data === null) return ''
  if (typeof data === 'string') return data.substring(0, maxLength)
  try {
    return JSON.stringify(data).substring(0, maxLength)
  } catch {
    return String(data).substring(0, maxLength)
  }
}

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

  /**
   * Verify a cookie domain is valid for the current platform.
   * Prevents Set-Cookie injection from attacker-controlled servers (M3 fix).
   */
  private isDomainAllowedForPlatform(domain: string): boolean {
    const platformDomains: Record<string, string[]> = {
      douyin: ['douyin.com', 'bytedanceapi.com'],
      xiaohongshu: ['xiaohongshu.com'],
      kuaishou: ['kuaishou.com', 'kuaishouzt.com'],
      'wechat-channels': ['weixin.qq.com', 'qq.com', 'wechat.com']
    }
    const allowed = platformDomains[this.context.platform]
    if (!allowed) return true // unknown platform — allow (conservative)
    return allowed.some(d => domain === d || domain.endsWith('.' + d))
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
      for (const key of Object.keys(safeHeaders)) {
        if (SENSITIVE_LOG_HEADERS.has(key.toLowerCase())) {
          safeHeaders[key] = `*** (${String(safeHeaders[key]).length} chars)`
        }
      }
      logger.info(`[HttpClient] Headers: ${JSON.stringify(safeHeaders)}`)
      if (typeof options.data === 'string') {
        logger.info(`[HttpClient] Body (string, first 3000): ${options.data.substring(0, 3000)}`)
      }

      const response: AxiosResponse<T> = await axios(config)

      logger.info(`[HttpClient] Response: status=${response.status}, url=${response.request?.res?.responseUrl || response.config?.url || 'unknown'}`)

      // Detect clear authentication expiry. A 403 is often platform risk-control
      // or signature rejection, so don't mark the account expired from 403 alone.
      if (response.status === 401) {
        logger.warn(`[HttpClient] ${response.status} response for ${this.context.platform} — session may be expired`)
        try {
          const repo = getAccountRepository()
          const account = repo.getById(this.context.accountId)
          if (account && account.session_status === 'logged_in') {
            repo.updateSession(this.context.accountId, 'expired', this.context.cookies)
            saveDatabase()
            logger.info(`[HttpClient] Marked account ${this.context.accountId} as expired due to ${response.status}`)
          }
        } catch (e) {
          logger.warn('[HttpClient] Failed to update session expiry:', e)
        }
      } else if (response.status === 403) {
        logger.warn(`[HttpClient] 403 response for ${this.context.platform} — possible signature rejection or risk control`)
      }

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
        const code = err.code || 'none'
        const message = err.message || 'unknown error'
        const dataSummary = summarizeData(data)
        logger.error(
          `[${this.context.platform}] HTTP ${options.method} ${options.url} failed: ` +
          `status=${status ?? 'none'}, code=${code}, message=${message}`,
          data
        )
        throw new Error(
          `HTTP ${options.method} ${options.url} failed: ` +
          `status=${status ?? 'none'} code=${code} message=${message}` +
          (dataSummary ? ` data=${dataSummary}` : '')
        )
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

      // Persist updated cookies — prefer callback (decoupled from DB) over direct DB access (M13 fix)
      if (this.context.accountId) {
        if (this.context.onCookiesRefreshed) {
          // New path: delegate to caller-provided callback
          this.context.onCookiesRefreshed(this.context.accountId, newCookieStr, this.context.platform)
        } else {
          // Legacy path: direct DB access (will be removed once all callers provide the callback)
          const repo = getAccountRepository()
          const account = repo.getById(this.context.accountId)
          if (account) {
          // Update the stored cookie JSON with new values
          let storedCookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }> = []
          try {
            // Decrypt first — cookies may be encrypted after M1 fix
            storedCookies = JSON.parse(decryptString(account.cookies || '[]'))
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

            // Validate Domain attribute — reject cookies for foreign domains (M3 fix)
            const cookieDomain = attrs.domain || response.request?.host || ''
            if (cookieDomain && !this.isDomainAllowedForPlatform(cookieDomain)) {
              logger.warn(`[HttpClient] Rejected Set-Cookie for foreign domain: ${cookieName} @ ${cookieDomain}`)
              continue
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

          repo.updateSession(this.context.accountId, 'logged_in', encryptString(JSON.stringify(storedCookies)))
          saveDatabase()
          logger.info(`[HttpClient] Cookies refreshed from Set-Cookie: ${setCookies.length} headers, total: ${storedCookies.length} cookies`)
          } // end if (account)
        } // end else (legacy DB path)
      } // end if (this.context.accountId)
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
