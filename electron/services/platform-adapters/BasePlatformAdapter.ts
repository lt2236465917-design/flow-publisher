import type { BrowserContext, Page } from 'playwright-core'
import type { IPlatformAdapter, LoginResult, UploadProgress } from './IPlatformAdapter'
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
    // Set a default timeout for all Playwright operations to prevent infinite hangs
    page.setDefaultTimeout(15000)
    page.setDefaultNavigationTimeout(30000)
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
          // Wait for page to fully load and cookies to be set
          logger.info(`[${this.platformId}] Login detected, waiting for session to stabilize...`)
          await delay(5000)

          // Extract account info
          const info = await this.extractAccountInfo(page)
          logger.info(`[${this.platformId}] Login successful: ${info.displayName}`)

          // Additional wait to ensure all cookies are captured
          await delay(2000)

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

  protected async humanType(page: Page, selector: string, text: string): Promise<void> {
    const el = await page.$(selector)
    if (!el) {
      logger.warn(`[${this.platformId}] Selector not found for typing: ${selector}`)
      return
    }
    await el.click()
    await delay(200)
    for (const char of text) {
      await page.keyboard.type(char, { delay: 0 })
      await delay(50 + Math.random() * 100)
    }
  }

  protected async waitForUploadComplete(
    page: Page,
    selectors: { progressBar: string; uploadArea: string; titleInput: string },
    onProgress?: (p: UploadProgress) => void
  ): Promise<void> {
    const maxWait = 300_000
    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      try {
        const progressText = await page.evaluate((sel) => {
          const el = document.querySelector(sel)
          return el?.textContent || ''
        }, selectors.progressBar)
        const match = progressText.match(/(\d+)%/)
        if (match) {
          const percent = Number(match[1])
          onProgress?.({ percent: 20 + Math.round(percent * 0.8), stage: `上传中 ${percent}%` })
          if (percent >= 100) return
        }
        const uploadArea = await page.$(selectors.uploadArea)
        if (!uploadArea) return
        const titleInput = await page.$(selectors.titleInput)
        if (titleInput) return
      } catch {}
      await delay(2000)
    }
  }
}
