import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { KS_URLS } from './ks-urls'
import { KS_SELECTORS } from './ks-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync } from 'fs'

export class KsAdapter extends BasePlatformAdapter {
  readonly platformId = 'kuaishou'
  readonly platformName = '快手'
  readonly loginUrl = KS_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 2048,
      maxDurationSec: 600,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'challenges',
        type: 'tags',
        label: '话题挑战',
        placeholder: '输入话题挑战名称'
      },
      {
        name: 'magicEmoji',
        type: 'checkbox',
        label: '使用魔法表情',
        defaultValue: false
      },
      {
        name: 'localVisible',
        type: 'checkbox',
        label: '同城可见',
        defaultValue: false
      }
    ]
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[kuaishou] Waiting for QR code...')
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(KS_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[kuaishou] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('cp.kuaishou.com/article') || url.includes('cp.kuaishou.com/home')) {
      return true
    }
    const avatar = await page.$(KS_SELECTORS.loginSuccess)
    return avatar !== null
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const avatarEl = await page.$(KS_SELECTORS.avatarImg)
      const avatarUrl = avatarEl ? await avatarEl.getAttribute('src') ?? undefined : undefined
      const nameEl = await page.$(KS_SELECTORS.userName)
      const displayName = nameEl ? await nameEl.textContent() ?? undefined : undefined
      return { displayName: displayName || '快手用户', avatarUrl }
    } catch {
      return { displayName: '快手用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(KS_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
      logger.info('[kuaishou] Navigating to publish page...')
      onProgress?.({ percent: 0, stage: '正在打开发布页面...' })
      await page.goto(KS_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await delay(3000)

      onProgress?.({ percent: 10, stage: '正在上传视频...' })
      const fileInput = await page.waitForSelector(KS_SELECTORS.uploadInput, { timeout: 10000 })
      if (!fileInput) throw new Error('未找到上传输入框')
      await fileInput.setInputFiles(filePath)

      onProgress?.({ percent: 20, stage: '视频上传中...' })
      await this.waitForUploadComplete(page, {
        progressBar: KS_SELECTORS.progressBar,
        uploadArea: KS_SELECTORS.uploadArea,
        titleInput: KS_SELECTORS.titleInput
      }, onProgress)
      onProgress?.({ percent: 100, stage: '视频上传完成' })

      logger.info('[kuaishou] Video upload complete')
    } catch (e) {
      logger.error('[kuaishou] uploadVideo error:', e)
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
        await page.goto(KS_URLS.publish, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await delay(3000)
      }

      // Fill title
      logger.info('[kuaishou] Filling title...')
      if (payload.title) {
        await this.humanType(page, KS_SELECTORS.titleInput, payload.title)
      }

      // Fill description
      logger.info('[kuaishou] Filling description...')
      if (payload.description) {
        await this.humanType(page, KS_SELECTORS.descInput, payload.description)
      }

      // Add hashtags
      if (payload.hashtags.length > 0) {
        logger.info('[kuaishou] Adding hashtags...')
        for (const tag of payload.hashtags) {
          try {
            const tagInput = await page.$(KS_SELECTORS.hashtagInput)
            if (tagInput) {
              await tagInput.click()
              await this.humanType(page, KS_SELECTORS.hashtagInput, tag)
              await delay(500)
              await page.keyboard.press('Enter')
              await delay(300)
            }
          } catch (e) {
            logger.warn(`[kuaishou] Failed to add hashtag "${tag}":`, e)
          }
        }
      }

      // Handle declarations
      if (payload.declarations.length > 0) {
        logger.info('[kuaishou] Setting declarations...')
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
            logger.warn(`[kuaishou] Failed to set declaration "${decl}":`, e)
          }
        }
      }

      // Handle platform-specific fields
      if (payload.platformFields) {
        const fields = payload.platformFields

        // Challenges (tags input)
        if (Array.isArray(fields.challenges) && fields.challenges.length > 0) {
          for (const challenge of fields.challenges) {
            try {
              const challengeInput = await page.$(KS_SELECTORS.challengeInput)
              if (challengeInput) {
                await challengeInput.click()
                await this.humanType(page, KS_SELECTORS.challengeInput, String(challenge))
                await delay(500)
                await page.keyboard.press('Enter')
                await delay(300)
              }
            } catch (e) {
              logger.warn(`[kuaishou] Failed to add challenge "${challenge}":`, e)
            }
          }
        }

        // Magic emoji toggle
        if (fields.magicEmoji) {
          try {
            const magicEl = await page.$(KS_SELECTORS.magicEmojiSelector)
            if (magicEl) {
              await magicEl.click()
              await delay(500)
            }
          } catch (e) {
            logger.warn('[kuaishou] Failed to toggle magic emoji:', e)
          }
        }

        // Local visibility toggle
        if (fields.localVisible) {
          try {
            const localEl = await page.$(KS_SELECTORS.localToggle)
            if (localEl) {
              await localEl.click()
              await delay(500)
            }
          } catch (e) {
            logger.warn('[kuaishou] Failed to toggle local visibility:', e)
          }
        }
      }

      // Click publish button
      logger.info('[kuaishou] Clicking publish...')
      const submitBtn = await page.waitForSelector(KS_SELECTORS.submitBtn, { timeout: 10000 })
      if (!submitBtn) throw new Error('未找到发布按钮')
      await submitBtn.click()

      await delay(5000)
      logger.info('[kuaishou] Content submitted successfully')
    } catch (e) {
      logger.error('[kuaishou] submitContent error:', e)
      throw e
    } finally {
      await page.close()
    }
  }
}
