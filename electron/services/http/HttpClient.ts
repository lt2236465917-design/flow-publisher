import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { logger } from '../../utils/logger'
import { Agent as HttpsAgent } from 'https'

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
}

export interface ApiResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
}

const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69'

// Browser-like headers matching yixiaoer's createHttpInstance
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': REALISTIC_UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip,deflate,br',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Connection: 'keep-alive',
  'sec-ch-ua': '"Microsoft Edge";v="117", "Not;A=Brand";v="8", "Chromium";v="117"',
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
    const config: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      data: options.data,
      params: options.params,
      adapter: 'http',
      httpsAgent: HTTPS_AGENT,
      headers: {
        ...BROWSER_HEADERS,
        ...(options.noCookie ? {} : { Cookie: this.context.cookies }),
        ...options.headers
      },
      timeout: options.timeout || DEFAULT_TIMEOUT,
      responseType: options.responseType || 'json',
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
      logger.info(`[HttpClient] Headers: ${JSON.stringify(config.headers)}`)
      if (typeof options.data === 'string') {
        logger.info(`[HttpClient] Body (string, first 500): ${options.data.substring(0, 500)}`)
      }

      const response: AxiosResponse<T> = await axios(config)

      logger.info(`[HttpClient] Response: status=${response.status}, url=${response.request?.res?.responseUrl || response.config?.url || 'unknown'}`)
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
