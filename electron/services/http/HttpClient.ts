import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { logger } from '../../utils/logger'

const DEFAULT_TIMEOUT = 30_000
const UPLOAD_TIMEOUT = 300_000

export interface CookieContext {
  cookies: string
  platform: string
  accountId: string
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeout?: number
  responseType?: 'json' | 'arraybuffer' | 'blob' | 'text'
  onUploadProgress?: (progress: { loaded: number; total: number; percent: number }) => void
}

export interface ApiResponse<T = unknown> {
  status: number
  data: T
  headers: Record<string, string>
}

const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export class HttpClient {
  private context: CookieContext

  constructor(context: CookieContext) {
    this.context = context
  }

  getCookieString(): string {
    return this.context.cookies
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<ApiResponse<T>> {
    const config: AxiosRequestConfig = {
      method: options.method,
      url: options.url,
      data: options.data,
      params: options.params,
      headers: {
        'User-Agent': REALISTIC_UA,
        Cookie: this.context.cookies,
        ...options.headers
      },
      timeout: options.timeout || DEFAULT_TIMEOUT,
      responseType: options.responseType || 'json',
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
      const response: AxiosResponse<T> = await axios(config)
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
    headers?: Record<string, string>
  ): Promise<ApiResponse<T>> {
    return this.request<T>({ method: 'GET', url, params, headers })
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
