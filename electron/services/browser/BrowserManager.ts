import { chromium, type BrowserContext } from 'playwright-core'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { STEALTH_ARGS, STEALTH_SCRIPTS } from './StealthConfig'
import { BrowserLaunchError } from '../../utils/errors'
import { logger } from '../../utils/logger'
import { redactUrl, summarizePayload } from '../../utils/log-redaction'

function getUserDataDir(): string {
  const { app } = require('electron')
  return join(app.getPath('userData'), 'browser-profiles')
}

// 2026年最新的Chrome浏览器版本
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'

export class BrowserManager {
  private context: BrowserContext | null = null
  private launchPromise: Promise<BrowserContext> | null = null
  private _cleanLaunch = false

  /** Next launch will delete the profile directory for a fresh start */
  setCleanLaunch(): void {
    this._cleanLaunch = true
  }

  async getContext(platformId: string): Promise<BrowserContext> {
    // Reuse existing context if browser is still alive
    if (this.context) {
      try {
        // Verify browser is still connected by checking browser.isConnected()
        // pages() can return [] (length 0) for a valid context with no open tabs
        if (this.context.browser()?.isConnected() !== false) {
          const pages = this.context.pages()
          logger.info(`Reusing existing browser context (${pages.length} pages open)`)
          return this.context
        }
      } catch {
        logger.warn('Existing browser context is stale, relaunching...')
        this.context = null
      }
    }

    // If a launch is already in progress, wait for it
    if (this.launchPromise) {
      return this.launchPromise
    }

    this.launchPromise = this.doLaunch(platformId)
    try {
      const ctx = await this.launchPromise
      return ctx
    } finally {
      this.launchPromise = null
    }
  }

  private async doLaunch(platformId: string): Promise<BrowserContext> {
    const executablePath = this.findBrowser()
    if (!executablePath) {
      throw new BrowserLaunchError('未找到 Chrome 或 Edge 浏览器')
    }

    const profileDir = join(getUserDataDir(), platformId)
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true })
    }

    // Delete the profile directory to ensure a clean state (no persistent cookies)
    // Only for login flows — for normal operation, reuse existing profile
    if (this._cleanLaunch) {
      try {
        const { rmSync } = require('fs')
        rmSync(profileDir, { recursive: true, force: true })
        mkdirSync(profileDir, { recursive: true })
        logger.info(`Deleted profile directory for clean login: ${profileDir}`)
      } catch (e) {
        logger.warn('Failed to delete profile directory:', e)
      }
      this._cleanLaunch = false
    }
    logger.info(`Launching browser for ${platformId}, profile: ${profileDir}`)

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath,
      args: STEALTH_ARGS,
      viewport: { width: 1366, height: 768 },
      locale: 'zh-CN',
      userAgent: REALISTIC_UA,
      bypassCSP: true
    })

    await this.context.addInitScript(STEALTH_SCRIPTS)

    // --- Network monitor: log all WeChat Channels API requests ---
    this.context.on('request', (request) => {
      const url = request.url()
      if (url.includes('channels.weixin.qq.com') && url.includes('/cgi-bin/')) {
        const method = request.method()
        const postData = request.postData()
        logger.info(`[NET-MON] ${method} ${redactUrl(url)}`)
        if (postData) {
          logger.info(
            `[NET-MON] Body summary: ${JSON.stringify(summarizePayload(postData))}`
          )
        }
      }
    })
    this.context.on('response', (response) => {
      const url = response.url()
      if (url.includes('channels.weixin.qq.com') && url.includes('/cgi-bin/')) {
        response.text().then((body) => {
          logger.info(
            `[NET-MON] Response ${response.status()} ${redactUrl(url)}, ` +
            `body=${JSON.stringify(summarizePayload(body))}`
          )
        }).catch(() => {})
      }
    })
    logger.info('Browser launched successfully (network monitor active)')
    return this.context
  }

  /** Clear all cookies at browser level (including persistent profile cookies) */
  async clearAllCookies(platformId?: string): Promise<void> {
    if (!this.context) return
    try {
      const pages = this.context.pages()
      if (pages.length > 0) {
        const client = await this.context.newCDPSession(pages[0])
        // Clear ALL browser cookies across all domains
        await client.send('Network.clearBrowserCookies')

        // Clear storage for platform-specific origins
        const origins: string[] = []
        if (platformId === 'wechat-channels' || !platformId) {
          origins.push('https://channels.weixin.qq.com')
        }
        if (platformId === 'kuaishou' || !platformId) {
          origins.push('https://cp.kuaishou.com')
          origins.push('https://www.kuaishou.com')
        }
        if (platformId === 'douyin' || !platformId) {
          origins.push('https://creator.douyin.com')
        }
        if (platformId === 'xiaohongshu' || !platformId) {
          origins.push('https://creator.xiaohongshu.com')
        }

        for (const origin of origins) {
          try {
            await client.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
          } catch {
            // Origin may not have storage
          }
        }

        await client.detach()
        logger.info(`All browser cookies and storage cleared via CDP (platform: ${platformId || 'all'})`)
      }
    } catch (e) {
      logger.warn('Failed to clear browser cookies via CDP:', e)
    }
  }

  /** Get all cookies via CDP (includes profile cookies not visible to Playwright) */
  async getAllCookiesViaCDP(page?: import('playwright-core').Page): Promise<Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
    sameSite?: string
    session?: boolean
  }>> {
    if (!this.context) return []
    try {
      const targetPage = page || this.context.pages()[0]
      if (!targetPage) return []
      const client = await this.context.newCDPSession(targetPage)
      const result = await client.send('Network.getAllCookies')
      await client.detach()
      return result.cookies || []
    } catch (e) {
      logger.warn('Failed to get cookies via CDP:', e)
      return []
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close()
      } catch {
        // Browser may already be closed
      }
      this.context = null
      logger.info('Browser closed')
    }
  }

  isOpen(): boolean {
    return this.context !== null
  }

  private findBrowser(): string | null {
    // 1. 尝试获取系统默认浏览器路径
    const defaultBrowser = this.getDefaultBrowserPath()
    if (defaultBrowser) return defaultBrowser

    // 2. 回退：依次查找 Edge、Chrome
    const candidates = [
      // Edge (Windows 自带)
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      // Chrome
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/microsoft-edge',
      '/usr/bin/chromium-browser'
    ]
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  private getDefaultBrowserPath(): string | null {
    try {
      if (process.platform === 'win32') {
        // 从注册表读取默认浏览器
        const result = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
          { encoding: 'utf-8', timeout: 1000 }
        )
        const match = result.match(/ProgId\s+REG_SZ\s+(.+)/)
        if (!match) return null

        const progId = match[1].trim()
        const appCmd = execSync(
          `reg query "HKCR\\${progId}\\shell\\open\\command" /ve`,
          { encoding: 'utf-8', timeout: 1000 }
        )
        const pathMatch = appCmd.match(/REG_SZ\s+"([^"]+)"/)
        if (pathMatch && existsSync(pathMatch[1])) {
          logger.info(`Default browser found: ${pathMatch[1]}`)
          return pathMatch[1]
        }
      }
    } catch {
      // 注册表读取失败，回退到候选列表
    }
    return null
  }
}
