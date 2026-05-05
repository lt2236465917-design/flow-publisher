import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import { WC_URLS } from './wc-urls'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'

export class WcAdapter extends BasePlatformAdapter {
  readonly platformId = 'wechat-channels'
  readonly platformName = '视频号'
  readonly loginUrl = WC_URLS.login

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[wechat-channels] Waiting for QR code...')
    await delay(5000)
    for (let i = 0; i < 30; i++) {
      try {
        // 视频号的二维码可能是微信扫码
        const qrEl = await page.$('img[class*="qrcode"], canvas[class*="qr"], img[src*="qrcode"], div[class*="qr"] img, img[class*="scan"]')
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
    // 检查 URL 是否跳转到了后台页面
    if (url.includes('channels.weixin.qq.com/platform/post') && !url.includes('create')) {
      return true
    }
    // 检查页面是否有已登录的元素
    const hasAvatar = await page.$('img[class*="avatar"], div[class*="avatar"]')
    if (hasAvatar) return true
    // 检查是否有登录二维码（有二维码说明还没登录）
    const hasQr = await page.$('img[class*="qrcode"], canvas[class*="qr"]')
    if (hasQr) return false
    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    await delay(2000)

    try {
      const result = await page.evaluate(() => {
        let avatarUrl: string | undefined
        const avatarEls = document.querySelectorAll('img[class*="avatar"], img[src*="avatar"]')
        for (const el of avatarEls) {
          const src = (el as HTMLImageElement).src
          if (src && !src.includes('default')) {
            avatarUrl = src
            break
          }
        }

        let displayName: string | undefined
        const allEls = document.querySelectorAll('span, div, p')
        for (const el of allEls) {
          const text = el.textContent?.trim()
          if (!text || text.length < 2 || text.length > 20) continue
          const skip = ['视频号', '发布', '首页', '数据', '创作', '登录', '注册', '搜索']
          if (skip.some(s => text.includes(s))) continue
          const rect = el.getBoundingClientRect()
          if (rect.top < 100 && rect.top >= 0) {
            displayName = text
            break
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
}
