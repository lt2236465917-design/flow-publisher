import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { logger } from '../../utils/logger'

const SIGN_TIMEOUT = 10_000

// Yixiaoer external signature server (fallback)
const YIXIAOER_SIGN_PORTS: Record<string, string[]> = {
  douyin: ['5041', '5042'],
  kuaishou: ['5008', '5009', '5010', '5011'],
  xiaohongshu: ['5096']
}
const YIXIAOER_SIGN_BASE = 'http://qianming.yixiaoer.cn'

interface SignRequest {
  platform: string
  cookie: string
  data: string
}

interface SignResult {
  signature: string
}

/**
 * Local signature service using Playwright.
 *
 * For each platform, maintains a hidden browser context with the creator page loaded.
 * When a signature is requested, evaluates the platform's signature JS in the browser context.
 *
 * This replaces yixiaoer's external signature server (qianming.yixiaoer.cn).
 */
export class SignService {
  private contexts = new Map<string, BrowserContext>()
  private pages = new Map<string, Page>()
  private initializing = new Map<string, Promise<void>>()

  /**
   * Get the signature for a given request.
   * Tries local Playwright-based signing first, falls back to external service.
   */
  async getSignature(platform: string, cookie: string, data: string): Promise<string> {
    try {
      let signature = ''

      switch (platform) {
        case 'douyin':
          signature = await this.getDouyinSignature(cookie, data)
          break
        case 'xiaohongshu':
          signature = await this.getXhsSignature(cookie, data)
          break
        case 'kuaishou':
          signature = await this.getKuaishouSignature(cookie, data)
          break
        default:
          logger.warn(`[sign] No signature implementation for platform: ${platform}`)
          return ''
      }

      // Fallback to external signature server if local signing failed
      if (!signature) {
        logger.info(`[sign] Local signing failed for ${platform}, trying external service...`)
        signature = await this.getExternalSignature(platform, cookie)
      }

      return signature
    } catch (err) {
      logger.error(`[sign] Failed to get signature for ${platform}:`, err)
      // Last resort: try external service
      return await this.getExternalSignature(platform, cookie)
    }
  }

  /**
   * Douyin a_bogus signature generation.
   *
   * Uses Playwright's page.route() to intercept outgoing requests.
   * When we trigger an API call from the browser context, Douyin's anti-bot JS
   * adds the a_bogus parameter to the URL. We intercept the request, extract
   * the signature, and abort the request before it's actually sent.
   */
  private async getDouyinSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('douyin', cookie, 'https://creator.douyin.com/creator-micro/home')

    try {
      const msTokenMatch = cookie.match(/msToken=([^;]+)/)
      const msToken = msTokenMatch ? msTokenMatch[1] : ''

      let capturedSignature = ''

      // Set up route interceptor to capture a_bogus from outgoing requests
      await page.route('**/aweme/v1/**', async (route) => {
        const url = route.request().url()
        const match = url.match(/a_bogus=([^&]+)/)
        if (match && match[1]) {
          capturedSignature = match[1]
        }
        // Abort the request — we only needed the signature
        await route.abort()
      })

      // Trigger a lightweight API call from the browser context.
      // Douyin's anti-bot JS intercepts XHR/fetch and adds a_bogus before sending.
      await page.evaluate(
        ({ msToken }) => {
          const xhr = new XMLHttpRequest()
          xhr.open(
            'GET',
            `https://creator.douyin.com/aweme/v1/creator/user/info/?msToken=${msToken}&a_bogus=`
          )
          xhr.send()
        },
        { msToken }
      )

      // Wait briefly for the route interceptor to fire
      await page.waitForTimeout(2000)

      // Clean up the route
      await page.unroute('**/aweme/v1/**')

      if (capturedSignature) {
        logger.info('[sign] Douyin a_bogus captured successfully')
        return capturedSignature
      }

      logger.warn('[sign] Douyin a_bogus not captured — anti-bot JS may not have intercepted the request')
      return ''
    } catch (err) {
      logger.error('[sign] Douyin signature generation failed:', err)
      this.resetPage('douyin')
      return ''
    }
  }

  /**
   * Try to get signature from yixiaoer's external signature server (fallback).
   * Returns empty string if unavailable.
   */
  private async getExternalSignature(platform: string, cookie: string): Promise<string> {
    const ports = YIXIAOER_SIGN_PORTS[platform]
    if (!ports) return ''

    for (const port of ports) {
      try {
        const url = `${YIXIAOER_SIGN_BASE}:${port}/Sign/GetSign`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: '',
            cookie,
            signType: 'browser',
            signCommand: platform
          }),
          signal: controller.signal
        })
        clearTimeout(timeout)

        const result = (await response.json()) as { signature?: string; err?: string }
        if (result.signature && result.signature !== 'null') {
          logger.info(`[sign] External signature obtained for ${platform} via port ${port}`)
          return result.signature
        }
      } catch {
        // Try next port
      }
    }
    return ''
  }

  /**
   * Xiaohongshu X-s / X-t signature generation.
   */
  private async getXhsSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('xiaohongshu', cookie, 'https://creator.xiaohongshu.com/publish/publish')

    try {
      const signature = await page.evaluate(
        ({ data }) => {
          return new Promise<string>((resolve) => {
            // XHS uses X-s and X-t headers for signature
            // These are generated by their anti-bot JS
            const win = window as Record<string, unknown>

            // Try to find XHS signature function
            if (typeof win._webmsxyw === 'function') {
              const result = win._webmsxyw(data)
              resolve(JSON.stringify(result))
            } else {
              // Fallback: make a test request and intercept headers
              resolve('')
            }

            setTimeout(() => resolve(''), 3000)
          })
        },
        { data }
      )

      return signature || ''
    } catch (err) {
      logger.error('[sign] XHS signature generation failed:', err)
      this.resetPage('xiaohongshu')
      return ''
    }
  }

  /**
   * Kuaishou __NS_sig3 signature generation.
   *
   * Uses the same pattern as Douyin: load the creator page in a headless browser,
   * trigger an API call from the browser context, intercept the outgoing request
   * to capture the __NS_sig3 parameter that Kuaishou's anti-bot JS adds.
   *
   * @param data JSON string with { url, body } — url is the API path (e.g. "/rest/cp/works/v2/video/pc/upload/finish")
   */
  private async getKuaishouSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('kuaishou', cookie, 'https://cp.kuaishou.com/article/publish/video')

    try {
      const { url: apiUrl, body } = JSON.parse(data) as { url: string; body?: string }
      let capturedSig3 = ''

      // Set up route interceptor to capture __NS_sig3 from outgoing requests
      await page.route('**/cp.kuaishou.com/rest/**', async (route) => {
        const reqUrl = route.request().url()
        const match = reqUrl.match(/__NS_sig3=([^&]+)/)
        if (match && match[1]) {
          capturedSig3 = match[1]
          logger.info(`[sign] Kuaishou __NS_sig3 captured: ${capturedSig3.substring(0, 20)}...`)
        }
        // Abort — we only needed the signature
        await route.abort()
      })

      // Trigger an API call from the browser context.
      // Kuaishou's anti-bot JS intercepts fetch/XHR and adds __NS_sig3 before sending.
      await page.evaluate(
        ({ apiUrl, body }) => {
          const fullUrl = `https://cp.kuaishou.com${apiUrl}`
          const fetchOptions: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            credentials: 'include'
          }
          if (body) {
            fetchOptions.body = body
          }
          fetch(fullUrl, fetchOptions).catch(() => {})
        },
        { apiUrl, body: body || '' }
      )

      // Wait for the route interceptor to fire
      await page.waitForTimeout(3000)

      // Clean up the route
      await page.unroute('**/cp.kuaishou.com/rest/**')

      if (capturedSig3) {
        logger.info(`[sign] Kuaishou __NS_sig3 captured successfully`)
        return capturedSig3
      }

      logger.warn('[sign] Kuaishou __NS_sig3 not captured — anti-bot JS may not have intercepted the request')
      return ''
    } catch (err) {
      logger.error('[sign] Kuaishou signature generation failed:', err)
      this.resetPage('kuaishou')
      return ''
    }
  }

  /**
   * Get or create a browser context and page for a platform.
   */
  private async getOrCreatePage(platform: string, cookie: string, url: string): Promise<Page> {
    // Wait if already initializing
    const initPromise = this.initializing.get(platform)
    if (initPromise) {
      await initPromise
    }

    const existingPage = this.pages.get(platform)
    if (existingPage && !existingPage.isClosed()) {
      // Update cookies
      const context = existingPage.context()
      await context.clearCookies()
      const cookieDomainMap: Record<string, string> = {
        douyin: '.douyin.com',
        xiaohongshu: '.xiaohongshu.com',
        kuaishou: '.kuaishou.com'
      }
      const domain = cookieDomainMap[platform] || '.douyin.com'
      const cookieArray = cookie.split('; ').map((c) => {
        const [name, ...valueParts] = c.split('=')
        return {
          name: name.trim(),
          value: valueParts.join('='),
          domain,
          path: '/'
        }
      })
      await context.addCookies(cookieArray)
      return existingPage
    }

    // Create new context and page
    const initResolve: (() => void)[] = []
    const initPromiseNew = new Promise<void>((resolve) => {
      initResolve.push(resolve)
    })
    this.initializing.set(platform, initPromiseNew)

    try {
      const profileDir = join(this.getSignDataDir(), platform)
      if (!existsSync(profileDir)) {
        mkdirSync(profileDir, { recursive: true })
      }

      const executablePath = this.findBrowser()
      if (!executablePath) {
        throw new Error('未找到 Chrome 或 Edge 浏览器')
      }

      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        executablePath,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-CN',
        bypassCSP: true
      })

      // Set cookies with correct domain for each platform
      await context.clearCookies()
      const cookieDomainMap: Record<string, string> = {
        douyin: '.douyin.com',
        xiaohongshu: '.xiaohongshu.com',
        kuaishou: '.kuaishou.com'
      }
      const domain = cookieDomainMap[platform] || '.douyin.com'
      const cookieArray = cookie.split('; ').map((c) => {
        const [name, ...valueParts] = c.split('=')
        return {
          name: name.trim(),
          value: valueParts.join('='),
          domain,
          path: '/'
        }
      })
      await context.addCookies(cookieArray)

      const page = await context.newPage()

      // Add stealth scripts
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true
        })
        delete (navigator as Record<string, unknown>).__proto__.webdriver
      })

      logger.info(`[sign] Loading ${platform} creator page: ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Wait for page JS to initialize
      await page.waitForTimeout(5000)

      this.contexts.set(platform, context)
      this.pages.set(platform, page)

      logger.info(`[sign] ${platform} signature context ready`)
      return page
    } finally {
      initResolve[0]?.()
      this.initializing.delete(platform)
    }
  }

  private resetPage(platform: string): void {
    const page = this.pages.get(platform)
    if (page && !page.isClosed()) {
      page.close().catch(() => {})
    }
    this.pages.delete(platform)
  }

  private findBrowser(): string | null {
    try {
      if (process.platform === 'win32') {
        const result = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
          { encoding: 'utf-8', timeout: 1000 }
        )
        const match = result.match(/ProgId\s+REG_SZ\s+(.+)/)
        if (match) {
          const progId = match[1].trim()
          if (progId.includes('Edge')) {
            const p = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
            if (existsSync(p)) return p
          }
          if (progId.includes('Chrome')) {
            const p = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            if (existsSync(p)) return p
          }
        }
      }
    } catch {}
    const candidates = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  private getSignDataDir(): string {
    const { app } = require('electron')
    const dir = join(app.getPath('userData'), 'sign-profiles')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /**
   * Clean up all browser contexts.
   */
  async dispose(): Promise<void> {
    for (const [platform, page] of this.pages) {
      try {
        if (!page.isClosed()) await page.close()
      } catch (err) {
        logger.error(`[sign] Error closing ${platform} page:`, err)
      }
    }
    for (const [platform, context] of this.contexts) {
      try {
        await context.close()
      } catch (err) {
        logger.error(`[sign] Error closing ${platform} context:`, err)
      }
    }
    this.pages.clear()
    this.contexts.clear()
  }
}

// Singleton instance
let signServiceInstance: SignService | null = null

export function getSignService(): SignService {
  if (!signServiceInstance) {
    signServiceInstance = new SignService()
  }
  return signServiceInstance
}
