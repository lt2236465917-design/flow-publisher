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
    await delay(2000)

    try {
      // 用 page.evaluate 直接在页面里查找
      const result = await page.evaluate(() => {
        // 找头像
        let avatarUrl: string | undefined
        const avatarEls = document.querySelectorAll('img[class*="avatar"], img[src*="avatar"]')
        for (const el of avatarEls) {
          const src = (el as HTMLImageElement).src
          if (src && !src.includes('default')) {
            avatarUrl = src
            break
          }
        }

        // 找用户名 - 遍历所有文本节点
        let displayName: string | undefined
        const allEls = document.querySelectorAll('span, div, p, a')
        for (const el of allEls) {
          const text = el.textContent?.trim()
          if (!text || text.length < 2 || text.length > 20) continue
          // 跳过导航和功能文字
          const skip = ['首页', '发布', '数据', '互动', '抖音', '创作者', '服务', '登录', '注册', '搜索', '消息', '设置']
          if (skip.some(s => text.includes(s))) continue
          // 检查是否在页面顶部区域（通常头像附近）
          const rect = el.getBoundingClientRect()
          if (rect.top < 100 && rect.top >= 0) {
            displayName = text
            break
          }
        }

        return { displayName, avatarUrl }
      })

      logger.info(`[douyin] Extracted: name=${result.displayName}, avatar=${result.avatarUrl ? 'yes' : 'no'}`)
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
