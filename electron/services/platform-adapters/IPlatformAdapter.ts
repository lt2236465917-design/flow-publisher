import type { BrowserContext, Page } from 'playwright-core'

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

  // Login
  startLogin(context: BrowserContext): Promise<Page>
  waitForQRCode(page: Page): Promise<string | null>
  waitForLoginResult(page: Page, timeoutMs?: number): Promise<LoginResult>
  checkSession(context: BrowserContext): Promise<boolean>
  logout(context: BrowserContext): Promise<void>

  // Publish (optional — adapters implement as they add publish support)
  getVideoConstraints?(): VideoConstraints
  uploadVideo?(context: BrowserContext, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<void>
  submitContent?(context: BrowserContext, payload: SubmitContentPayload): Promise<void>
}
