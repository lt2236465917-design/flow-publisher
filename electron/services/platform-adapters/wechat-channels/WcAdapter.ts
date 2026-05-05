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
    if (url.includes('channels.weixin.qq.com/platform/post') && !url.includes('create')) {
      return true
    }
    // 在 create 页面检查侧边栏是否有账号名（说明已登录）
    const nameEl = await page.$('div.account-info span.name')
    if (nameEl) {
      const text = await nameEl.textContent()
      if (text && text.trim().length >= 2) return true
    }
    // 检查是否有登录二维码（有二维码说明还没登录）
    const hasQr = await page.$('img[class*="qrcode"], canvas[class*="qr"]')
    if (hasQr) return false
    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const currentUrl = page.url()
      logger.info(`[wechat-channels] extractAccountInfo: current URL = ${currentUrl}`)

      // 如果在 post/create 页面，先导航到 post/list（账号信息更完整）
      if (currentUrl.includes('post/create')) {
        logger.info('[wechat-channels] On create page, navigating to post/list')
        await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 15000 })
      }

      // 等待侧边栏账号名出现
      try {
        await page.waitForSelector('div.account-info span.name', { timeout: 10000 })
        logger.info('[wechat-channels] Account name element found')
      } catch {
        logger.warn('[wechat-channels] Account name not found within 10s')
      }

      const result = await page.evaluate(() => {
        // 找头像
        let avatarUrl: string | undefined
        const avatarEl = document.querySelector('img.avatar') as HTMLImageElement | null
        if (avatarEl?.src) {
          avatarUrl = avatarEl.src
        }

        // 找用户名
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
}
