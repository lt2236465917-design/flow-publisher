import { chromium, type BrowserContext } from 'playwright-core'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { STEALTH_ARGS, STEALTH_SCRIPTS } from './StealthConfig'
import { BrowserLaunchError } from '../../utils/errors'
import { logger } from '../../utils/logger'

function getUserDataDir(): string {
  const { app } = require('electron')
  return join(app.getPath('userData'), 'browser-profiles')
}

const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export class BrowserManager {
  private context: BrowserContext | null = null

  async getContext(platformId: string): Promise<BrowserContext> {
    if (this.context) return this.context

    const executablePath = this.findBrowser()
    if (!executablePath) {
      throw new BrowserLaunchError('未找到 Chrome 或 Edge 浏览器')
    }

    const profileDir = join(getUserDataDir(), platformId)
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true })
    }
    logger.info(`Launching browser for ${platformId}, profile: ${profileDir}`)

    this.context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath,
      args: STEALTH_ARGS,
      viewport: { width: 1366, height: 768 },
      locale: 'zh-CN',
      ignoreHTTPSErrors: true,
      userAgent: REALISTIC_UA,
      bypassCSP: true
    })

    await this.context.addInitScript(STEALTH_SCRIPTS)
    logger.info('Browser launched successfully')
    return this.context
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close()
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
          { encoding: 'utf-8', timeout: 3000 }
        )
        const match = result.match(/ProgId\s+REG_SZ\s+(.+)/)
        if (!match) return null

        const progId = match[1].trim()
        const appCmd = execSync(
          `reg query "HKCR\\${progId}\\shell\\open\\command" /ve`,
          { encoding: 'utf-8', timeout: 3000 }
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
