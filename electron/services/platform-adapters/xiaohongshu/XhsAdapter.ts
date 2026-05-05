import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { XHS_URLS } from './xhs-urls'
import { XHS_SELECTORS } from './xhs-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync } from 'fs'

export class XhsAdapter extends BasePlatformAdapter {
  readonly platformId = 'xiaohongshu'
  readonly platformName = '小红书'
  readonly loginUrl = XHS_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 4096,
      maxDurationSec: 900,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'noteType',
        type: 'select',
        label: '笔记类型',
        options: [
          { label: '视频笔记', value: 'video' },
          { label: '图文笔记', value: 'image' }
        ],
        defaultValue: 'video'
      },
      {
        name: 'productLinks',
        type: 'tags',
        label: '关联商品',
        placeholder: '输入商品名称或链接'
      },
      {
        name: 'location',
        type: 'text',
        label: '地点标注',
        placeholder: '搜索地点'
      }
    ]
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[xiaohongshu] Waiting for QR code...')
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(XHS_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[xiaohongshu] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('creator.xiaohongshu.com/publish') || url.includes('creator.xiaohongshu.com/home')) {
      return true
    }
    const avatar = await page.$(XHS_SELECTORS.loginSuccess)
    return avatar !== null
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const avatarEl = await page.$(XHS_SELECTORS.avatarImg)
      const avatarUrl = avatarEl ? await avatarEl.getAttribute('src') ?? undefined : undefined
      const nameEl = await page.$(XHS_SELECTORS.userName)
      const displayName = nameEl ? await nameEl.textContent() ?? undefined : undefined
      return { displayName: displayName || '小红书用户', avatarUrl }
    } catch {
      return { displayName: '小红书用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(XHS_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
      logger.info('[xiaohongshu] Navigating to publish page...')
      onProgress?.({ percent: 0, stage: '正在打开发布页面...' })
      await page.goto(XHS_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000)

      onProgress?.({ percent: 10, stage: '正在上传视频...' })
      const fileInput = await page.waitForSelector(XHS_SELECTORS.uploadInput, { timeout: 10000 })
      if (!fileInput) throw new Error('未找到上传输入框')
      await fileInput.setInputFiles(filePath)

      onProgress?.({ percent: 20, stage: '视频上传中...' })
      await this.waitForUploadComplete(page, {
        progressBar: XHS_SELECTORS.progressBar,
        uploadArea: XHS_SELECTORS.uploadArea,
        titleInput: XHS_SELECTORS.titleInput
      }, onProgress)
      onProgress?.({ percent: 100, stage: '视频上传完成' })

      logger.info('[xiaohongshu] Video upload complete')
    } catch (e) {
      logger.error('[xiaohongshu] uploadVideo error:', e)
      throw e
    } finally {
      await page.close()
    }
  }

  async submitContent(context: BrowserContext, payload: SubmitContentPayload): Promise<void> {
    const page = await context.newPage()
    try {
      const url = page.url()
      if (!url.includes('publish')) {
        await page.goto(XHS_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await delay(3000)
      }

      // Fill title
      logger.info('[xiaohongshu] Filling title...')
      if (payload.title) {
        await this.humanType(page, XHS_SELECTORS.titleInput, payload.title)
      }

      // Fill description
      logger.info('[xiaohongshu] Filling description...')
      if (payload.description) {
        await this.humanType(page, XHS_SELECTORS.descInput, payload.description)
      }

      // Add hashtags
      if (payload.hashtags.length > 0) {
        logger.info('[xiaohongshu] Adding hashtags...')
        for (const tag of payload.hashtags) {
          try {
            const tagInput = await page.$(XHS_SELECTORS.hashtagInput)
            if (tagInput) {
              await tagInput.click()
              await this.humanType(page, XHS_SELECTORS.hashtagInput, tag)
              await delay(500)
              await page.keyboard.press('Enter')
              await delay(300)
            }
          } catch (e) {
            logger.warn(`[xiaohongshu] Failed to add hashtag "${tag}":`, e)
          }
        }
      }

      // Handle declarations
      if (payload.declarations.length > 0) {
        logger.info('[xiaohongshu] Setting declarations...')
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
            logger.warn(`[xiaohongshu] Failed to set declaration "${decl}":`, e)
          }
        }
      }

      // Handle platform-specific fields
      if (payload.platformFields) {
        const fields = payload.platformFields

        // Note type selection
        if (fields.noteType) {
          try {
            const tabs = await page.$$(XHS_SELECTORS.noteTypeSelector)
            for (const tab of tabs) {
              const text = await tab.textContent()
              if (text && text.includes(String(fields.noteType === 'video' ? '视频' : '图文'))) {
                await tab.click()
                await delay(500)
                break
              }
            }
          } catch (e) {
            logger.warn('[xiaohongshu] Failed to set note type:', e)
          }
        }

        // Location
        if (fields.location) {
          try {
            const locationInput = await page.$(XHS_SELECTORS.locationInput)
            if (locationInput) {
              await locationInput.click()
              await this.humanType(page, XHS_SELECTORS.locationInput, String(fields.location))
              await delay(1000)
              await page.keyboard.press('Enter')
              await delay(500)
            }
          } catch (e) {
            logger.warn('[xiaohongshu] Failed to set location:', e)
          }
        }

        // Product links
        if (Array.isArray(fields.productLinks) && fields.productLinks.length > 0) {
          for (const link of fields.productLinks) {
            try {
              const productInput = await page.$(XHS_SELECTORS.productLinkInput)
              if (productInput) {
                await productInput.click()
                await this.humanType(page, XHS_SELECTORS.productLinkInput, String(link))
                await delay(500)
                await page.keyboard.press('Enter')
                await delay(300)
              }
            } catch (e) {
              logger.warn(`[xiaohongshu] Failed to add product link "${link}":`, e)
            }
          }
        }
      }

      // Click publish button
      logger.info('[xiaohongshu] Clicking publish...')
      const submitBtn = await page.waitForSelector(XHS_SELECTORS.submitBtn, { timeout: 10000 })
      if (!submitBtn) throw new Error('未找到发布按钮')
      await submitBtn.click()

      await delay(5000)
      logger.info('[xiaohongshu] Content submitted successfully')
    } catch (e) {
      logger.error('[xiaohongshu] submitContent error:', e)
      throw e
    } finally {
      await page.close()
    }
  }
}
