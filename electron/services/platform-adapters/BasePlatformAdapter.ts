import type { BrowserContext, Page } from 'playwright-core'
import type { IPlatformAdapter, LoginResult } from './IPlatformAdapter'
import { LoginTimeoutError } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { delay } from '../../utils/delays'

const DEFAULT_LOGIN_TIMEOUT = 120_000

export abstract class BasePlatformAdapter implements IPlatformAdapter {
  abstract readonly platformId: string
  abstract readonly platformName: string
  abstract readonly loginUrl: string

  async startLogin(context: BrowserContext): Promise<Page> {
    const page = await context.newPage()
    await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded' })
    logger.info(`[${this.platformId}] Navigated to login page: ${this.loginUrl}`)
    return page
  }

  abstract waitForQRCode(page: Page): Promise<string | null>

  async waitForLoginResult(page: Page, timeoutMs = DEFAULT_LOGIN_TIMEOUT): Promise<LoginResult> {
    const startTime = Date.now()
    logger.info(`[${this.platformId}] Waiting for login result (timeout: ${timeoutMs}ms)`)

    while (Date.now() - startTime < timeoutMs) {
      try {
        const isLoggedIn = await this.detectLoginSuccess(page)
        if (isLoggedIn) {
          // 等待页面加载用户信息
          await delay(3000)
          const info = await this.extractAccountInfo(page)
          logger.info(`[${this.platformId}] Login successful: ${info.displayName}`)
          return { success: true, ...info }
        }
      } catch {
        // Page might navigate, ignore
      }
      await delay(2000)
    }

    throw new LoginTimeoutError(this.platformId, timeoutMs)
  }

  abstract checkSession(context: BrowserContext): Promise<boolean>

  async logout(context: BrowserContext): Promise<void> {
    await context.clearCookies()
    logger.info(`[${this.platformId}] Logged out, cookies cleared`)
  }

  protected abstract detectLoginSuccess(page: Page): Promise<boolean>
  protected abstract extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }>
}
