import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { logger } from '../../utils/logger'

const SIGN_TIMEOUT = 10_000

// Yixiaoer external signature server (fallback)
const YIXIAOER_SIGN_PORTS: Record<string, string[]> = {
  douyin: ['5041', '5042'],
  kuaishou: ['5008', '5009', '5010', '5011'],
  xiaohongshu: ['5096'],
  newxiaohongshu: ['5061', '5062', '5063']
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
  private fallbackConfirmer: ((platform: string) => Promise<boolean>) | null = null
  private fallbackCache = new Map<string, boolean>()

  /**
   * Set a callback to confirm before falling back to local signing.
   * When set, the callback is invoked (and awaited) before any local Playwright
   * signing is attempted. The result is cached per-platform for the current session.
   *
   * If no confirmer is set (null), local signing is NEVER attempted — the method
   * returns an empty string when external signing fails. This is the safe default
   * for unattended contexts like scheduled tasks.
   */
  setFallbackConfirmer(fn: ((platform: string) => Promise<boolean>) | null): void {
    this.fallbackConfirmer = fn
  }

  /**
   * Clear the per-platform fallback confirmation cache.
   * Call this at the start of each publish operation so the user is re-prompted
   * if external signing fails again for a different publish.
   */
  clearFallbackCache(): void {
    this.fallbackCache.clear()
  }

  /**
   * Get the signature for a given request.
   *
   * Priority: external yixiaoer service first (signatures generated in real browser
   * environment on their servers, indistinguishable from real users), then local
   * Playwright-based signing as fallback (requires user confirmation via fallbackConfirmer).
   *
   * @param body Request body string — used by kuaishou external service (MD5 of body)
   */
  async getSignature(platform: string, cookie: string, data: string, body?: string): Promise<string> {
    try {
      // Priority 1: External yixiaoer signing service (real browser environment)
      let signature = ''

      // For douyin, the data parameter IS the full URL to sign
      const urlToSign = platform === 'douyin' ? data : ''

      signature = await this.getExternalSignature(platform, cookie, body, urlToSign)

      if (signature) {
        logger.info(`[sign] ${platform} signature from external service`)
        return signature
      }

      // Priority 2: Local Playwright-based signing (fallback)
      // Require user confirmation before using local signing — Playwright-based
      // signing may be detected by platforms and lead to account restrictions.
      const cached = this.fallbackCache.get(platform)
      if (cached === false) {
        logger.info(`[sign] ${platform} local signing previously denied by user, skipping`)
        return ''
      }
      if (cached !== true) {
        if (this.fallbackConfirmer) {
          logger.info(`[sign] ${platform} asking user for local signing confirmation`)
          const confirmed = await this.fallbackConfirmer(platform)
          this.fallbackCache.set(platform, confirmed)
          if (!confirmed) {
            logger.info(`[sign] ${platform} local signing denied by user`)
            return ''
          }
        } else {
          // No confirmer set (e.g. scheduled task) — never use local signing
          logger.info(`[sign] ${platform} no confirmer set, skipping local signing for safety`)
          return ''
        }
      }

      logger.info(`[sign] External service unavailable for ${platform}, trying local signing...`)

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

      return signature
    } catch (err) {
      logger.error(`[sign] Failed to get signature for ${platform}:`, err)
      return ''
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
  private async getDouyinSignature(cookie: string, data: string, body?: string): Promise<string> {
    const page = await this.getOrCreatePage('douyin', cookie, 'https://creator.douyin.com/creator-micro/home')

    try {
      const msTokenMatch = cookie.match(/msToken=([^;]+)/)
      const msToken = msTokenMatch ? msTokenMatch[1] : ''

      let capturedSignature = ''

      // Set up route interceptor to capture a_bogus from outgoing requests
      // Match both aweme/v1 and web/api paths — anti-bot may rewrite to either
      const routeHandler = async (route: { request(): { url(): string }; abort(): Promise<void> }) => {
        const url = route.request().url()
        const match = url.match(/a_bogus=([^&]+)/)
        if (match && match[1]) {
          capturedSignature = match[1]
        }
        await route.abort()
      }

      await page.route('**/*a_bogus*', routeHandler)
      await page.route('**/aweme/v1/**', routeHandler)

      // Wait longer for anti-bot JS to fully initialize (it may load lazily)
      await page.waitForTimeout(3000)

      // Try both XHR and fetch — anti-bot may hook either one
      await page.evaluate(
        ({ msToken }) => {
          // First try XHR
          try {
            const xhr = new XMLHttpRequest()
            xhr.open(
              'GET',
              `https://creator.douyin.com/aweme/v1/creator/user/info/?msToken=${msToken}&a_bogus=`
            )
            xhr.send()
          } catch {}

          // Also try fetch as fallback
          try {
            fetch(
              `https://creator.douyin.com/aweme/v1/creator/user/info/?msToken=${msToken}&a_bogus=`,
              { method: 'GET', credentials: 'include' }
            ).catch(() => {})
          } catch {}
        },
        { msToken }
      )

      // Wait for the route interceptor to fire
      await page.waitForTimeout(3000)

      // Clean up routes
      await page.unroute('**/*a_bogus*', routeHandler)
      await page.unroute('**/aweme/v1/**', routeHandler)

      if (capturedSignature) {
        logger.info('[sign] Douyin a_bogus captured successfully')
        return capturedSignature
      }

      logger.warn('[sign] Douyin a_bogus not captured — trying external service')

      // Try external service with the full URL to sign
      const urlToSign = data || ''
      if (urlToSign) {
        return await this.getExternalSignature('douyin', cookie, body, urlToSign)
      }

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
   *
   * For kuaishou: the `cookie` param must be MD5(requestBody), matching yixiaoer's getSign$5.
   * @param urlToSign The full URL to sign (used by douyin external service)
   */
  private async getExternalSignature(platform: string, cookie: string, body?: string, urlToSign?: string): Promise<string> {
    const ports = YIXIAOER_SIGN_PORTS[platform]
    if (!ports) return ''

    // Kuaishou's signing service expects MD5(body) as the cookie parameter (yixiaoer's approach)
    const signCookie = (platform === 'kuaishou' && body)
      ? createHash('md5').update(body).digest('hex')
      : cookie

    for (const port of ports) {
      try {
        const url = `${YIXIAOER_SIGN_BASE}:${port}/Sign/GetSign`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: urlToSign || '',
            cookie: signCookie,
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
   *
   * Tries:
   * 1. Local Playwright-based signing via _webmsxyw function on the XHS page
   * 2. New external signing service (ports 5061-5063, signCommand: "newxiaohongshu")
   * 3. Old external signing service (port 5096, signCommand: "xiaohongshu")
   */
  private async getXhsSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('xiaohongshu', cookie, 'https://creator.xiaohongshu.com/publish/publish')

    try {
      // Step 1: Get X-s and X-t from _webmsxyw
      const signature = await page.evaluate(
        ({ data }) => {
          return new Promise<string>((resolve) => {
            const win = window as Record<string, unknown>

            if (typeof win._webmsxyw === 'function') {
              const result = win._webmsxyw(data)
              resolve(JSON.stringify(result))
            } else {
              resolve('')
            }

            setTimeout(() => resolve(''), 3000)
          })
        },
        { data }
      )

      // Log what _webmsxyw returned for debugging
      if (signature) {
        try {
          const sigObj = JSON.parse(signature)
          logger.info(`[sign] XHS _webmsxyw returned keys: ${Object.keys(sigObj).join(', ')}`)
        } catch { /* ignore */ }
      }

      // Step 2: Capture X-S-Common via route interceptor
      // X-S-Common is added by anti-bot JS's XHR/fetch interceptor when making same-origin requests.
      // We trigger a same-origin fetch (creator.xiaohongshu.com) so the anti-bot JS intercepts it.
      let capturedXSCommon = ''
      const routePattern = '**/edith.xiaohongshu.com/**'
      const routeHandler = async (route: any) => {
        const headers = route.request().headers()
        const xsCommon = headers['x-s-common']
        if (xsCommon) {
          capturedXSCommon = xsCommon
          logger.info(`[sign] XHS X-S-Common captured: ${capturedXSCommon.substring(0, 30)}...`)
        }
        // Also log all custom headers for debugging
        const customHeaders = Object.keys(headers).filter(h => h.startsWith('x-'))
        if (customHeaders.length > 0) {
          logger.info(`[sign] XHS intercepted request x-headers: ${customHeaders.join(', ')}`)
        }
        await route.abort()
      }

      try {
        await page.route(routePattern, routeHandler)

        // Parse the URL path and body from data
        const parsed = JSON.parse(data) as { url?: string; body?: string }
        const urlPath = parsed.url || '/web_api/sns/v2/note'
        const bodyStr = parsed.body || ''

        // Try triggering an XHR to the same edith endpoint — XHR may be hooked differently than fetch
        await page.evaluate(
          ({ urlPath, bodyStr }) => {
            // Use XHR instead of fetch — anti-bot may hook XHR differently
            try {
              const xhr = new XMLHttpRequest()
              xhr.open('POST', `https://edith.xiaohongshu.com${urlPath}`, true)
              xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8')
              xhr.withCredentials = true
              xhr.send(bodyStr || null)
            } catch {}
          },
          { urlPath, bodyStr }
        )

        // Wait for the route interceptor to fire
        await page.waitForTimeout(3000)

        // If XHR didn't work, try fetch as fallback
        if (!capturedXSCommon) {
          await page.evaluate(
            ({ urlPath, bodyStr }) => {
              const fullUrl = `https://edith.xiaohongshu.com${urlPath}`
              const opts: RequestInit = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                credentials: 'include'
              }
              if (bodyStr) opts.body = bodyStr
              fetch(fullUrl, opts).catch(() => {})
            },
            { urlPath, bodyStr }
          )
          await page.waitForTimeout(3000)
        }
      } catch (interceptErr) {
        logger.warn('[sign] XHS X-S-Common interception failed:', interceptErr)
      } finally {
        try { await page.unroute(routePattern, routeHandler) } catch {}
      }

      // Step 3: Combine X-s, X-t, and X-S-Common
      if (signature) {
        const parsed = JSON.parse(signature) as Record<string, unknown>
        if (capturedXSCommon) {
          parsed['X-S-Common'] = capturedXSCommon
        }
        return JSON.stringify(parsed)
      }

      // If _webmsxyw failed but we got X-S-Common, still return it
      if (capturedXSCommon) {
        logger.info('[sign] XHS: _webmsxyw failed but X-S-Common captured')
      }
    } catch (err) {
      logger.warn('[sign] XHS Playwright signing failed:', err)
      this.resetPage('xiaohongshu')
    }

    // Try new external signing service (yixiaoer's "newxiaohongshu" format)
    try {
      const parsed = JSON.parse(data) as { url?: string; body?: string }
      const urlPath = parsed.url || '/web_api/sns/v2/note'
      const bodyStr = parsed.body || ''

      const newSignPorts = YIXIAOER_SIGN_PORTS['newxiaohongshu']
      for (const port of newSignPorts) {
        try {
          const url = `${YIXIAOER_SIGN_BASE}:${port}/Sign/GetSign`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 8000)

          const cookieValue = bodyStr
            ? JSON.stringify([urlPath, encodeURIComponent(bodyStr)])
            : JSON.stringify([urlPath])

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: '',
              cookie: cookieValue,
              signType: 'browser',
              signCommand: 'newxiaohongshu'
            }),
            signal: controller.signal
          })
          clearTimeout(timeout)

          const result = (await response.json()) as { signature?: string }
          if (result.signature && result.signature !== 'null') {
            logger.info(`[sign] XHS new external signature obtained via port ${port}`)
            return result.signature
          }
        } catch {
          // Try next port
        }
      }
    } catch {
      // Ignore parse errors
    }

    return ''
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

    const routePattern = '**/cp.kuaishou.com/rest/**'
    let capturedSig3 = ''
    let routeHandler: ((route: any) => Promise<void>) | null = null

    try {
      const { url: apiUrl, body } = JSON.parse(data) as { url: string; body?: string }

      // Set up route interceptor to capture __NS_sig3 from outgoing requests
      routeHandler = async (route: any) => {
        const reqUrl = route.request().url()
        const match = reqUrl.match(/__NS_sig3=([^&]+)/)
        if (match && match[1]) {
          capturedSig3 = match[1]
          logger.info(`[sign] Kuaishou __NS_sig3 captured: ${capturedSig3.substring(0, 20)}...`)
        }
        // Abort — we only needed the signature
        await route.abort()
      }
      await page.route(routePattern, routeHandler)

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
    } finally {
      // Always clean up the route to prevent leaks on retry
      try {
        if (routeHandler) {
          await page.unroute(routePattern, routeHandler)
        } else {
          await page.unroute(routePattern)
        }
      } catch {
        // Ignore cleanup errors — page may already be closed
      }
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
    // Cross-platform browser discovery — ordered by likelihood
    const platformCandidates: Record<string, string[]> = {
      win32: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ],
    }

    // Try Windows registry first (most accurate on Windows)
    if (process.platform === 'win32') {
      try {
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
      } catch { /* registry query can fail; fall through to candidates */ }
    }

    const candidates = platformCandidates[process.platform] || platformCandidates.win32
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
   * Get a specific cookie value from the loaded page for a platform.
   * Useful for extracting cookies set by the platform's JS (e.g., msToken for Douyin).
   */
  async getCookieFromPage(platform: string, cookieName: string): Promise<string> {
    const page = this.pages.get(platform)
    if (!page || page.isClosed()) return ''

    try {
      const cookies = await page.context().cookies()
      const match = cookies.find((c) => c.name === cookieName)
      return match?.value || ''
    } catch {
      return ''
    }
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
