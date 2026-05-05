import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import { DOUYIN_URLS } from './douyin-urls'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'

export class DouyinAdapter extends BasePlatformAdapter {
  readonly platformId = 'douyin'
  readonly platformName = '抖音'
  readonly loginUrl = DOUYIN_URLS.login

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

      // 等待名字元素出现（最多 15 秒）
      // 抖音创作者后台的名字在 div[class*="name-"] 叶子节点里
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
        // === 找头像 ===
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

        // === 找用户名 ===
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
}
