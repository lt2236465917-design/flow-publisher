import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { SubmitContentPayload, VideoConstraints, UploadProgress } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { WC_URLS } from './wc-urls'
import { WC_SELECTORS } from './wc-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync } from 'fs'

/**
 * WeChat Channels adapter using pure browser automation.
 *
 * Based on yixiaoer's approach: WeChat Channels does NOT support direct API calls.
 * All operations (login, upload, publish) must be done through browser automation.
 */
export class WcAdapter extends BasePlatformAdapter {
  readonly platformId = 'wechat-channels'
  readonly platformName = '视频号'
  readonly loginUrl = WC_URLS.login

  // Store upload page for reuse in submitContent
  private activePage: Page | null = null

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 2048,
      maxDurationSec: 1800,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv', 'mkv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'location',
        type: 'text',
        label: '位置信息',
        placeholder: '搜索位置'
      },
      {
        name: 'collection',
        type: 'dynamic-select',
        label: '添加合集',
        placeholder: '选择合集',
        dynamicKey: 'collections'
      },
      {
        name: 'originalDeclaration',
        type: 'checkbox',
        label: '声明原创',
        defaultValue: false
      }
    ]
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[wechat-channels] Waiting for QR code...')

    // Short wait for page to settle
    await delay(500)

    // Try to take a screenshot with a hard timeout
    const screenshotWithTimeout = async (timeoutMs: number): Promise<Buffer | null> => {
      return Promise.race([
        page.screenshot({ clip: { x: 0, y: 0, width: 1366, height: 768 } }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
      ])
    }

    const screenshot = await screenshotWithTimeout(3000)
    if (screenshot) {
      logger.info(`[wechat-channels] Page screenshot captured`)
      return `data:image/png;base64,${screenshot.toString('base64')}`
    }

    // First screenshot timed out — retry once
    logger.warn('[wechat-channels] First screenshot timed out, retrying...')
    await delay(300)
    const retry = await screenshotWithTimeout(3000)
    if (retry) {
      logger.info(`[wechat-channels] Retry screenshot captured`)
      return `data:image/png;base64,${retry.toString('base64')}`
    }

    logger.error('[wechat-channels] Screenshot failed (CDP broken). Returning null — will detect login via URL.')
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()

    // After successful WeChat login, the URL stays at /platform/post/create but
    // the page content changes (no more QR code, shows editor/nav instead).
    // Use page.evaluate() with timeout to check page content.
    if (url.includes('channels.weixin.qq.com/platform/post')) {
      try {
        const hasUserInfo = await Promise.race([
          page.evaluate(() => {
            // Look for elements that only appear after login
            const avatar = document.querySelector('img[class*="avatar"], div[class*="avatar"] img')
            const navItems = document.querySelectorAll('a[href*="post/list"], a[href*="post/create"]')
            const editor = document.querySelector('div[class*="editor"], div[class*="create"], div[class*="upload"]')
            const qrStillVisible = document.querySelector('img[class*="qrcode"], canvas[class*="qr"]')
            // Login succeeded if: user info visible, or editor visible, or QR is gone
            return !!(avatar || navItems.length > 0 || editor || !qrStillVisible)
          }),
          new Promise<boolean>((resolve) => setTimeout(() => {
            // If evaluate hangs, check URL as fallback — if we're still on /post/create
            // after timeout, assume login (the page wouldn't stay here without auth)
            logger.warn('[wechat-channels] detectLoginSuccess evaluate timeout, using URL fallback')
            resolve(url.includes('channels.weixin.qq.com/platform/post'))
          }, 5000))
        ])

        if (hasUserInfo) {
          logger.info('[wechat-channels] Login detected')
          return true
        }
      } catch {
        // evaluate failed — use URL-based fallback
        logger.warn('[wechat-channels] detectLoginSuccess evaluate failed, using URL fallback')
        return url.includes('channels.weixin.qq.com/platform/post')
      }
    }

    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const currentUrl = page.url()
      logger.info(`[wechat-channels] extractAccountInfo: current URL = ${currentUrl}`)

      if (currentUrl.includes('post/create')) {
        logger.info('[wechat-channels] On create page, navigating to post/list')
        await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 15000 })
        await delay(500)
      }

      try {
        await page.waitForSelector('div[class*="account-info"], div[class*="user-info"], img[class*="avatar"]', { timeout: 3000 })
        logger.info('[wechat-channels] Account info element found')
      } catch {
        logger.warn('[wechat-channels] Account info not found within 10s')
      }

      const result = await page.evaluate(() => {
        let avatarUrl: string | undefined
        const avatarSelectors = [
          'img[class*="avatar"]',
          'div[class*="avatar"] img',
          'img[src*="avatar"]',
          'div[class*="user-info"] img'
        ]
        for (const sel of avatarSelectors) {
          const el = document.querySelector(sel) as HTMLImageElement | null
          if (el?.src && !el.src.includes('default')) {
            avatarUrl = el.src
            break
          }
        }

        let displayName: string | undefined
        const nameSelectors = [
          'div[class*="account-info"] span[class*="name"]',
          'div[class*="user-info"] span[class*="name"]',
          'span[class*="nickname"]',
          'div[class*="account-name"]',
          'span[class*="user-name"]'
        ]
        for (const sel of nameSelectors) {
          const el = document.querySelector(sel)
          if (el) {
            const text = el.textContent?.trim()
            if (text && text.length >= 2 && text.length <= 20 &&
                !text.includes('首页') && !text.includes('发布') &&
                !text.includes('数据') && !text.includes('管理')) {
              displayName = text
              break
            }
          }
        }

        return { displayName, avatarUrl }
      })

      logger.info(`[wechat-channels] Extracted: name=${result.displayName}, avatar=${result.avatarUrl ? 'yes' : 'no'}`)
      return { displayName: result.displayName || '视频号用户', avatarUrl: result.avatarUrl }
    } catch (e) {
      logger.error('[wechat-channels] extractAccountInfo error:', e)
      return { displayName: '视频号用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await delay(500)
      const isLoggedIn = await this.detectLoginSuccess(page)
      await page.close()
      return isLoggedIn
    } catch {
      return false
    }
  }

  async uploadVideo(context: BrowserContext, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<void> {
    if (!existsSync(filePath)) throw new Error(`视频文件不存在: ${filePath}`)

    await this.cleanupActivePage()

    const page = await context.newPage()
    try {
      logger.info('[wechat-channels] Navigating to publish page...')
      onProgress?.({ percent: 0, stage: '正在打开发布页面...' })
      await page.goto(WC_URLS.publish, { waitUntil: 'networkidle', timeout: 60000 })
      await delay(3000)

      onProgress?.({ percent: 10, stage: '正在上传视频...' })

      // Try multiple selectors for file input
      let fileInput = await page.$('input[type="file"][accept*="video"]')
      if (!fileInput) {
        fileInput = await page.$('input[type="file"][accept*="mp4"]')
      }
      if (!fileInput) {
        fileInput = await page.$('input[type="file"][accept*="mov"]')
      }
      if (!fileInput) {
        fileInput = await page.$('input[type="file"]')
      }

      if (!fileInput) {
        // Try clicking upload area first to trigger file input
        const uploadArea = await page.$('div[class*="upload"], div[class*="drag-area"], div[class*="drop-zone"]')
        if (uploadArea) {
          await uploadArea.click()
          await delay(1000)
          fileInput = await page.$('input[type="file"]')
        }
      }

      if (!fileInput) throw new Error('未找到上传输入框')

      logger.info('[wechat-channels] Setting file input...')
      await fileInput.setInputFiles(filePath)

      onProgress?.({ percent: 20, stage: '视频上传中...' })

      // Wait for upload to complete
      await this.waitForUploadComplete(page, onProgress)
      onProgress?.({ percent: 100, stage: '视频上传完成' })

      this.activePage = page
      logger.info('[wechat-channels] Video upload complete, page kept alive for submit')
    } catch (e) {
      logger.error('[wechat-channels] uploadVideo error:', e)
      await page.close().catch(() => {})
      throw e
    }
  }

  private async waitForUploadComplete(page: Page, onProgress?: (p: UploadProgress) => void): Promise<void> {
    const maxWait = 600_000 // 10 minutes
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      try {
        // Check for progress indicators
        const progressText = await page.evaluate(() => {
          const progressEl = document.querySelector('div[class*="progress"], span[class*="progress"], div[class*="percent"]')
          return progressEl?.textContent || ''
        })

        const match = progressText.match(/(\d+)%/)
        if (match) {
          const percent = Number(match[1])
          onProgress?.({ percent: 20 + Math.round(percent * 0.8), stage: `上传中 ${percent}%` })
          if (percent >= 100) {
            logger.info('[wechat-channels] Upload progress reached 100%')
            await delay(2000) // Wait for UI to update
            return
          }
        }

        // Check if upload area is gone (upload complete)
        const uploadArea = await page.$('div[class*="upload"], div[class*="drag-area"]')
        if (!uploadArea) {
          logger.info('[wechat-channels] Upload area gone, assuming upload complete')
          return
        }

        // Check if title input is available (upload complete)
        const titleInput = await page.$('input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]')
        if (titleInput) {
          logger.info('[wechat-channels] Title input available, upload complete')
          return
        }

        // Check for error messages
        const errorMsg = await page.evaluate(() => {
          const errorEl = document.querySelector('div[class*="error"], div[class*="fail"], div[class*="toast"]')
          return errorEl?.textContent || ''
        })
        if (errorMsg && (errorMsg.includes('失败') || errorMsg.includes('错误') || errorMsg.includes('过大'))) {
          throw new Error(`上传失败: ${errorMsg}`)
        }

      } catch (e) {
        if ((e as Error).message?.includes('上传失败')) throw e
      }
      await delay(2000)
    }

    // If we get here, check one more time if upload completed
    const titleInput = await page.$('input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]')
    if (titleInput) {
      logger.info('[wechat-channels] Upload complete (final check)')
      return
    }

    throw new Error('上传超时')
  }

  async cleanupActivePage(): Promise<void> {
    if (this.activePage && !this.activePage.isClosed()) {
      try {
        await this.activePage.close()
      } catch {}
    }
    this.activePage = null
  }

  async submitContent(context: BrowserContext, payload: SubmitContentPayload): Promise<void> {
    let page: Page
    let shouldClosePage = false

    if (this.activePage && !this.activePage.isClosed()) {
      page = this.activePage
      this.activePage = null
      logger.info('[wechat-channels] Reusing upload page for submit')
    } else {
      page = await context.newPage()
      shouldClosePage = true
      logger.info('[wechat-channels] No active page, creating new page for submit')
      await page.goto(WC_URLS.publish, { waitUntil: 'networkidle', timeout: 60000 })
      await delay(3000)
    }

    try {
      // Fill title
      logger.info('[wechat-channels] Filling title...')
      if (payload.title) {
        const titleInput = await page.$('input[class*="title"], textarea[class*="title"], div[class*="title"] [contenteditable]')
        if (titleInput) {
          await titleInput.click()
          await delay(200)
          await titleInput.fill('')
          await delay(100)
          await titleInput.type(payload.title, { delay: 50 })
          logger.info('[wechat-channels] Title filled')
        } else {
          logger.warn('[wechat-channels] Title input not found')
        }
      }

      // Fill description
      logger.info('[wechat-channels] Filling description...')
      if (payload.description) {
        const descInput = await page.$('textarea[class*="desc"], div[class*="desc"] [contenteditable], div[class*="content"] [contenteditable]')
        if (descInput) {
          await descInput.click()
          await delay(200)
          await descInput.fill('')
          await delay(100)
          await descInput.type(payload.description, { delay: 30 })
          logger.info('[wechat-channels] Description filled')
        } else {
          logger.warn('[wechat-channels] Description input not found')
        }
      }

      // Add hashtags
      if (payload.hashtags.length > 0) {
        logger.info('[wechat-channels] Adding hashtags...')
        for (const tag of payload.hashtags) {
          try {
            const tagInput = await page.$('input[class*="tag"], input[placeholder*="话题"], input[placeholder*="标签"]')
            if (tagInput) {
              await tagInput.click()
              await delay(200)
              await tagInput.type(tag, { delay: 50 })
              await delay(500)
              await page.keyboard.press('Enter')
              await delay(300)
              logger.info(`[wechat-channels] Hashtag added: ${tag}`)
            }
          } catch (e) {
            logger.warn(`[wechat-channels] Failed to add hashtag "${tag}":`, e)
          }
        }
      }

      // Handle declarations
      if (payload.declarations.length > 0) {
        logger.info('[wechat-channels] Setting declarations...')
        for (const decl of payload.declarations) {
          try {
            const labels = await page.$$('label')
            for (const label of labels) {
              const text = await label.textContent()
              if (text && text.includes(decl)) {
                const checkbox = await label.$('input[type="checkbox"]')
                if (checkbox) {
                  const checked = await checkbox.isChecked()
                  if (!checked) await checkbox.click()
                  logger.info(`[wechat-channels] Declaration set: ${decl}`)
                }
              }
            }
          } catch (e) {
            logger.warn(`[wechat-channels] Failed to set declaration "${decl}":`, e)
          }
        }
      }

      // Handle platform-specific fields
      if (payload.platformFields) {
        if (payload.platformFields.originalDeclaration) {
          try {
            const labels = await page.$$('label')
            for (const label of labels) {
              const text = await label.textContent()
              if (text && text.includes('原创')) {
                const checkbox = await label.$('input[type="checkbox"]')
                if (checkbox) {
                  const checked = await checkbox.isChecked()
                  if (!checked) await checkbox.click()
                  logger.info('[wechat-channels] Original declaration set')
                }
              }
            }
          } catch (e) {
            logger.warn('[wechat-channels] Failed to set original declaration:', e)
          }
        }

        if (payload.platformFields.location) {
          try {
            const locationInput = await page.$('input[placeholder*="位置"], input[placeholder*="地点"]')
            if (locationInput) {
              await locationInput.click()
              await delay(200)
              await locationInput.type(String(payload.platformFields.location), { delay: 50 })
              await delay(1000)
              // Select first suggestion
              const suggestion = await page.$('div[class*="suggestion"] li:first-child, div[class*="dropdown"] div:first-child')
              if (suggestion) {
                await suggestion.click()
                logger.info('[wechat-channels] Location set')
              }
            }
          } catch (e) {
            logger.warn('[wechat-channels] Failed to set location:', e)
          }
        }
      }

      // Click publish button
      logger.info('[wechat-channels] Clicking publish...')
      const submitBtn = await page.$('button:has-text("发表"), button:has-text("发布"), button[class*="submit"], button[class*="publish"]')
      if (!submitBtn) throw new Error('未找到发布按钮')

      await submitBtn.click()
      logger.info('[wechat-channels] Publish button clicked')

      // Wait for publish to complete
      await delay(5000)

      // Check for success or error
      const result = await page.evaluate(() => {
        const successEl = document.querySelector('div[class*="success"], div[class*="toast"]')
        const errorEl = document.querySelector('div[class*="error"], div[class*="fail"]')
        return {
          success: successEl?.textContent || '',
          error: errorEl?.textContent || ''
        }
      })

      if (result.error && (result.error.includes('失败') || result.error.includes('错误'))) {
        throw new Error(`发布失败: ${result.error}`)
      }

      logger.info('[wechat-channels] Content submitted successfully')
    } catch (e) {
      logger.error('[wechat-channels] submitContent error:', e)
      throw e
    } finally {
      if (shouldClosePage) {
        await page.close().catch(() => {})
      }
    }
  }
}
