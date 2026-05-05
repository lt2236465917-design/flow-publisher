import type { BrowserContext, Page } from 'playwright-core'

export interface LoginResult {
  success: boolean
  displayName?: string
  avatarUrl?: string
  error?: string
}

export interface IPlatformAdapter {
  readonly platformId: string
  readonly platformName: string
  readonly loginUrl: string

  startLogin(context: BrowserContext): Promise<Page>
  waitForQRCode(page: Page): Promise<string | null>
  waitForLoginResult(page: Page, timeoutMs?: number): Promise<LoginResult>
  checkSession(context: BrowserContext): Promise<boolean>
  logout(context: BrowserContext): Promise<void>
}
