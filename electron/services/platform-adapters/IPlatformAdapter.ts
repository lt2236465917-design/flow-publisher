import type { BrowserContext, Page } from 'playwright-core'
import type { PlatformFieldDefinition } from '../../shared/types/platform-fields'
import type { HttpClient, CookieContext } from '../http/HttpClient'

export interface LoginResult {
  success: boolean
  displayName?: string
  avatarUrl?: string
  error?: string
}

export interface VideoConstraints {
  maxFileSizeMB: number
  maxDurationSec: number
  supportedFormats: string[]
}

export interface UploadProgress {
  percent: number
  stage: string
}

export interface SubmitContentPayload {
  title: string
  description: string
  hashtags: string[]
  coverPath?: string
  declarations: string[]
  platformFields?: Record<string, unknown>
}

export interface IPlatformAdapter {
  readonly platformId: string
  readonly platformName: string
  readonly loginUrl: string

  // Login (browser-based — always needed for QR code scanning)
  startLogin(context: BrowserContext): Promise<Page>
  waitForQRCode(page: Page): Promise<string | null>
  waitForLoginResult(page: Page, timeoutMs?: number): Promise<LoginResult>
  checkSession(context: BrowserContext): Promise<boolean>
  logout(context: BrowserContext): Promise<void>

  // Publish — Browser mode (legacy, Playwright-based)
  getVideoConstraints?(): VideoConstraints
  uploadVideo?(context: BrowserContext, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<void>
  submitContent?(context: BrowserContext, payload: SubmitContentPayload): Promise<void>
  getPlatformFields?(): PlatformFieldDefinition[]

  // Publish — API mode (new, HTTP-based)
  uploadVideoAPI?(client: HttpClient, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<string | void>
  submitContentAPI?(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void>
  checkSessionAPI?(client: HttpClient): Promise<boolean>
}
