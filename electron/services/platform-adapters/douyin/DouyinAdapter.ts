import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { DOUYIN_URLS } from './douyin-urls'
import { DOUYIN_SELECTORS } from './douyin-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync } from 'fs'

export class DouyinAdapter extends BasePlatformAdapter {
  readonly platformId = 'douyin'
  readonly platformName = '抖音'
  readonly loginUrl = DOUYIN_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 4096,
      maxDurationSec: 900,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv', 'mkv', 'wmv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      { name: 'collection', type: 'select', label: '合集选择', placeholder: '选择合集', options: [] },
      { name: 'mentions', type: 'tags', label: '@提及', placeholder: '输入要@的用户' },
      { name: 'poiLocation', type: 'text', label: 'POI 地点', placeholder: '搜索地点' },
      { name: 'miniApp', type: 'text', label: '小程序挂载', placeholder: '输入小程序 AppID' }
    ]
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[douyin] Waiting for QR code...')
    await delay(3000)
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$('div[class*="qrcode-wrapper"] img, div[class*="qrcode"] img, img[src*="qrcode"], img[src*="scan"]')
        if (qrEl) {
          const box = await qrEl.boundingBox()
          if (box && box.width > 50 && box.height > 50) {
            const screenshot = await qrEl.screenshot()
            logger.info('[douyin] QR code captured')
            return `data:image/png;base64,${screenshot.toString('base64')}`
          }
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('creator-micro/home') || url.includes('creator-micro/content/upload')) {
      return true
    }
    const hasQr = await page.$('div[class*="qrcode"], img[src*="qrcode"], canvas[class*="qr"]')
    if (hasQr) return false
    const hasLoginBtn = await page.$('button:has-text("登录"), div[class*="login-btn"]')
    if (hasLoginBtn) return false
    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const currentUrl = page.url()
      logger.info(`[douyin] extractAccountInfo: current URL = ${currentUrl}`)

      let nameFound = false
      try {
        await page.waitForFunction(() => {
          const els = document.querySelectorAll('[class*="name-"]')
          for (const el of els) {
            const t = el.textContent?.trim()
            if (t && t.length >= 2 && t.length <= 15 && el.children.length === 0) {
              const skip = ['关注', '粉丝', '获赞', '抖音号', '通知', '网址', '抖音', '官网']
              if (!skip.some(s => t.includes(s))) return true
            }
          }
          return false
        }, { timeout: 15000 })
        nameFound = true
        logger.info('[douyin] Name element found')
      } catch {
        logger.warn('[douyin] Name element not found within 15s')
      }

      const result = await page.evaluate(() => {
        let avatarUrl: string | undefined
        const avatarEls = document.querySelectorAll('div[class*="avatar"], img[class*="avatar"], img[src*="avatar"]')
        for (const el of avatarEls) {
          const htmlEl = el as HTMLElement
          const img = htmlEl.tagName === 'IMG' ? htmlEl : htmlEl.querySelector('img')
          const src = img ? (img as HTMLImageElement).src : ''
          const bg = htmlEl.style.backgroundImage || ''
          const url = src || bg.replace(/url\("?|"?\)/g, '')
          if (url && !url.includes('default') && url.startsWith('http')) {
            avatarUrl = url
            break
          }
        }

        let displayName: string | undefined
        const nameEls = document.querySelectorAll('[class*="name-"]')
        for (const el of nameEls) {
          const t = el.textContent?.trim()
          if (t && t.length >= 2 && t.length <= 15 && el.children.length === 0) {
            const skip = ['关注', '粉丝', '获赞', '抖音号', '通知', '网址', '抖音', '官网']
            if (!skip.some(s => t.includes(s))) {
              displayName = t
              break
            }
          }
        }

        return { displayName, avatarUrl }
      })

      logger.info(`[douyin] Extracted: name=${result.displayName}, avatar=${result.avatarUrl ? 'yes' : 'no'}, nameFound=${nameFound}`)
      return { displayName: result.displayName || '抖音用户', avatarUrl: result.avatarUrl }
    } catch (e) {
      logger.error('[douyin] extractAccountInfo error:', e)
      return { displayName: '抖音用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(DOUYIN_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await delay(3000)
      const isLoggedIn = await this.detectLoginSuccess(page)
      await page.close()
      return isLoggedIn
    } catch {
      return false
    }
  }

  async uploadVideo(context: BrowserContext, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<void> {
    if (!existsSync(filePath)) throw new Error(`视频文件不存在: ${filePath}`)

    const page = await context.newPage()
    try {
      logger.info('[douyin] Navigating to publish page...')
      onProgress?.({ percent: 0, stage: '正在打开发布页面...' })
      await page.goto(DOUYIN_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000)

      // Find file input and upload
      onProgress?.({ percent: 10, stage: '正在上传视频...' })
      const fileInput = await page.waitForSelector(DOUYIN_SELECTORS.uploadInput, { timeout: 10000 })
      if (!fileInput) throw new Error('未找到上传输入框')
      await fileInput.setInputFiles(filePath)

      // Monitor upload progress
      onProgress?.({ percent: 20, stage: '视频上传中...' })
      await this.waitForUploadComplete(page, {
        progressBar: DOUYIN_SELECTORS.progressBar,
        uploadArea: DOUYIN_SELECTORS.uploadArea,
        titleInput: DOUYIN_SELECTORS.titleInput
      }, onProgress)
      onProgress?.({ percent: 100, stage: '视频上传完成' })

      logger.info('[douyin] Video upload complete')
    } catch (e) {
      logger.error('[douyin] uploadVideo error:', e)
      throw e
    } finally {
      await page.close()
    }
  }

  async submitContent(context: BrowserContext, payload: SubmitContentPayload): Promise<void> {
    const page = await context.newPage()
    try {
      // Navigate if not already on publish page
      const url = page.url()
      if (!url.includes('content/upload')) {
        await page.goto(DOUYIN_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await delay(3000)
      }

      // Fill title
      logger.info('[douyin] Filling title...')
      if (payload.title) {
        await this.humanType(page, DOUYIN_SELECTORS.titleInput, payload.title)
      }

      // Fill description
      logger.info('[douyin] Filling description...')
      if (payload.description) {
        await this.humanType(page, DOUYIN_SELECTORS.descInput, payload.description)
      }

      // Add hashtags
      if (payload.hashtags.length > 0) {
        logger.info('[douyin] Adding hashtags...')
        for (const tag of payload.hashtags) {
          try {
            const tagInput = await page.$(DOUYIN_SELECTORS.hashtagInput)
            if (tagInput) {
              await tagInput.click()
              await this.humanType(page, DOUYIN_SELECTORS.hashtagInput, tag)
              await delay(500)
              await page.keyboard.press('Enter')
              await delay(300)
            }
          } catch (e) {
            logger.warn(`[douyin] Failed to add hashtag "${tag}":`, e)
          }
        }
      }

      // Handle declarations (check boxes)
      if (payload.declarations.length > 0) {
        logger.info('[douyin] Setting declarations...')
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
            logger.warn(`[douyin] Failed to set declaration "${decl}":`, e)
          }
        }
      }

      // Click publish button
      logger.info('[douyin] Clicking publish...')
      const submitBtn = await page.waitForSelector(DOUYIN_SELECTORS.submitBtn, { timeout: 10000 })
      if (!submitBtn) throw new Error('未找到发布按钮')
      await submitBtn.click()

      // Wait for success or error
      await delay(5000)
      logger.info('[douyin] Content submitted successfully')
    } catch (e) {
      logger.error('[douyin] submitContent error:', e)
      throw e
    } finally {
      await page.close()
    }
  }

}
