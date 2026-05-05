import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { WC_URLS } from './wc-urls'
import { WC_SELECTORS } from './wc-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync } from 'fs'

export class WcAdapter extends BasePlatformAdapter {
  readonly platformId = 'wechat-channels'
  readonly platformName = '视频号'
  readonly loginUrl = WC_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 2048,
      maxDurationSec: 1800,
      supportedFormats: ['mp4', 'mov', 'avi']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'articleLink',
        type: 'text',
        label: '公众号文章链接',
        placeholder: '输入公众号文章URL'
      },
      {
        name: 'extLink',
        type: 'text',
        label: '扩展链接',
        placeholder: '输入外部链接URL'
      }
    ]
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[wechat-channels] Waiting for QR code...')
    await delay(5000)
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(WC_SELECTORS.qrCode)
        if (qrEl) {
          const box = await qrEl.boundingBox()
          if (box && box.width > 50 && box.height > 50) {
            const screenshot = await qrEl.screenshot()
            logger.info('[wechat-channels] QR code captured')
            return `data:image/png;base64,${screenshot.toString('base64')}`
          }
        }
      } catch {}
      await delay(1000)
    }
    logger.warn('[wechat-channels] QR code not found')
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('channels.weixin.qq.com/platform/post') && !url.includes('create')) {
      return true
    }
    const nameEl = await page.$('div.account-info span.name')
    if (nameEl) {
      const text = await nameEl.textContent()
      if (text && text.trim().length >= 2) return true
    }
    const hasQr = await page.$('img[class*="qrcode"], canvas[class*="qr"]')
    if (hasQr) return false
    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const currentUrl = page.url()
      logger.info(`[wechat-channels] extractAccountInfo: current URL = ${currentUrl}`)

      if (currentUrl.includes('post/create')) {
        logger.info('[wechat-channels] On create page, navigating to post/list')
        await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 15000 })
      }

      try {
        await page.waitForSelector('div.account-info span.name', { timeout: 10000 })
        logger.info('[wechat-channels] Account name element found')
      } catch {
        logger.warn('[wechat-channels] Account name not found within 10s')
      }

      const result = await page.evaluate(() => {
        let avatarUrl: string | undefined
        const avatarEl = document.querySelector('img.avatar') as HTMLImageElement | null
        if (avatarEl?.src) {
          avatarUrl = avatarEl.src
        }

        let displayName: string | undefined
        const accountInfo = document.querySelector('div.account-info')
        if (accountInfo) {
          const nameEl = accountInfo.querySelector('span.name')
          if (nameEl) {
            const text = nameEl.textContent?.trim()
            if (text && text.length >= 2 && text.length <= 20) {
              displayName = text
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
      await delay(3000)
      const isLoggedIn = await this.detectLoginSuccess(page)
      await page.close()
      return isLoggedIn
    } catch {
      return false
    }
  }

  async uploadVideo(context: BrowserContext, filePath: string, onProgress?: (p: { percent: number; stage: string }) => void): Promise<void> {
    if (!existsSync(filePath)) throw new Error(`视频文件不存在: ${filePath}`)

    const page = await context.newPage()
    try {
      logger.info('[wechat-channels] Navigating to publish page...')
      onProgress?.({ percent: 0, stage: '正在打开发布页面...' })
      await page.goto(WC_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000)

      onProgress?.({ percent: 10, stage: '正在上传视频...' })
      const fileInput = await page.waitForSelector(WC_SELECTORS.uploadInput, { timeout: 10000 })
      if (!fileInput) throw new Error('未找到上传输入框')
      await fileInput.setInputFiles(filePath)

      onProgress?.({ percent: 20, stage: '视频上传中...' })
      await this.waitForUploadComplete(page, {
        progressBar: WC_SELECTORS.progressBar,
        uploadArea: WC_SELECTORS.uploadArea,
        titleInput: WC_SELECTORS.titleInput
      }, onProgress)
      onProgress?.({ percent: 100, stage: '视频上传完成' })

      logger.info('[wechat-channels] Video upload complete')
    } catch (e) {
      logger.error('[wechat-channels] uploadVideo error:', e)
      throw e
    } finally {
      await page.close()
    }
  }

  async submitContent(context: BrowserContext, payload: SubmitContentPayload): Promise<void> {
    const page = await context.newPage()
    try {
      const url = page.url()
      if (!url.includes('post/create')) {
        await page.goto(WC_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await delay(3000)
      }

      // Fill title
      logger.info('[wechat-channels] Filling title...')
      if (payload.title) {
        await this.humanType(page, WC_SELECTORS.titleInput, payload.title)
      }

      // Fill description
      logger.info('[wechat-channels] Filling description...')
      if (payload.description) {
        await this.humanType(page, WC_SELECTORS.descInput, payload.description)
      }

      // Add hashtags
      if (payload.hashtags.length > 0) {
        logger.info('[wechat-channels] Adding hashtags...')
        for (const tag of payload.hashtags) {
          try {
            const tagInput = await page.$(WC_SELECTORS.hashtagInput)
            if (tagInput) {
              await tagInput.click()
              await this.humanType(page, WC_SELECTORS.hashtagInput, tag)
              await delay(500)
              await page.keyboard.press('Enter')
              await delay(300)
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
        const fields = payload.platformFields

        // Article link
        if (fields.articleLink) {
          try {
            await this.humanType(page, WC_SELECTORS.articleLinkInput, String(fields.articleLink))
            await delay(500)
          } catch (e) {
            logger.warn('[wechat-channels] Failed to set article link:', e)
          }
        }

        // Extension link
        if (fields.extLink) {
          try {
            await this.humanType(page, WC_SELECTORS.extLinkInput, String(fields.extLink))
            await delay(500)
          } catch (e) {
            logger.warn('[wechat-channels] Failed to set ext link:', e)
          }
        }
      }

      // Click publish button
      logger.info('[wechat-channels] Clicking publish...')
      const submitBtn = await page.waitForSelector(WC_SELECTORS.submitBtn, { timeout: 10000 })
      if (!submitBtn) throw new Error('未找到发布按钮')
      await submitBtn.click()

      await delay(5000)
      logger.info('[wechat-channels] Content submitted successfully')
    } catch (e) {
      logger.error('[wechat-channels] submitContent error:', e)
      throw e
    } finally {
      await page.close()
    }
  }
}
