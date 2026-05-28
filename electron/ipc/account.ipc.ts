import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAccountRepository, saveDatabase } from '../services/database'
import { BrowserManager } from '../services/browser/BrowserManager'
import { CookieStore } from '../services/browser/CookieStore'
import { getAdapter } from '../services/platform-adapters/PlatformAdapterRegistry'
import { registerAdapter } from '../services/platform-adapters/PlatformAdapterRegistry'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { DouyinApiAdapter } from '../services/platform-adapters/douyin/DouyinApiAdapter'
import { XhsApiAdapter } from '../services/platform-adapters/xiaohongshu/XhsApiAdapter'
import { WcApiAdapter } from '../services/platform-adapters/wechat-channels/WcApiAdapter'
import { KsApiAdapter } from '../services/platform-adapters/kuaishou/KsApiAdapter'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import type { LoginResult } from '../services/platform-adapters/IPlatformAdapter'
import { logger } from '../utils/logger'

const browserManager = new BrowserManager()
const cookieStore = new CookieStore()

function clearBrowserProfile(platformId: string): void {
  const { app } = require('electron')
  const profileDir = join(app.getPath('userData'), 'browser-profiles', platformId)
  if (existsSync(profileDir)) {
    rmSync(profileDir, { recursive: true, force: true })
    logger.info(`Cleared browser profile: ${profileDir}`)
  }
}

// Register all adapters
registerAdapter(new DouyinApiAdapter())
registerAdapter(new XhsApiAdapter())
registerAdapter(new WcApiAdapter())
registerAdapter(new KsApiAdapter())

export function registerAccountIpcHandlers(): void {
  // List all accounts
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LIST, async (): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const rows = repo.getAll()
      const accounts = rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        sessionStatus: r.session_status,
        lastLoginAt: r.last_login_at
      }))
      return { success: true, data: accounts }
    } catch (err) {
      logger.error('ACCOUNT_LIST error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Start login flow for a platform
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGIN, async (event, platformId: string): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${platformId}` }
      }

      const repo = getAccountRepository()
      const existing = repo.getByPlatform(platformId)
      let accountId = existing[0]?.id

      if (!accountId) {
        const account = repo.create({ platform: platformId, displayName: adapter.platformName })
        accountId = account.id
        saveDatabase()
      }

      // Reuse existing browser if alive; only clear cookies for a fresh login
      const context = await browserManager.getContext(platformId)
      try {
        await context.clearCookies()
        logger.info('[account] Cleared cookies for fresh login')
      } catch {
        // Context may have been recreated
      }
      const page = await adapter.startLogin(context)

      // Send QR code to renderer
      logger.info('[account] Waiting for QR code...')
      const qrDataUrl = await adapter.waitForQRCode(page)
      if (qrDataUrl) {
        logger.info('[account] QR code captured, sending to renderer')
        const mainWindow = BrowserWindow.getAllWindows()[0]
        mainWindow?.webContents.send('account:qr-code', { accountId, platformId, qrDataUrl })
      } else {
        logger.warn('[account] QR code not captured (CDP may be broken). Login will proceed with URL-based detection.')
        // Notify the user that they need to scan QR in the browser window
        const mainWindow = BrowserWindow.getAllWindows()[0]
        mainWindow?.webContents.send('account:qr-code', {
          accountId, platformId,
          qrDataUrl: null,
          fallbackMessage: '无法截取二维码，请在弹出的浏览器窗口中扫码登录'
        })
      }

      // Wait for login result
      logger.info('[account] Waiting for login result...')
      const result: LoginResult = await adapter.waitForLoginResult(page)

      if (result.success) {
        logger.info('[account] Login successful, waiting for cookies to stabilize...')

        // Wait for JavaScript to set additional cookies
        await new Promise(resolve => setTimeout(resolve, 500))

        // Check if browser is still open before trying to interact
        const isStillOpen = browserManager.isOpen()

        if (isStillOpen) {
          // Navigate to different pages to trigger more cookie setting
          logger.info('[account] Navigating to trigger more cookies...')
          try {
            await page.goto('https://channels.weixin.qq.com/platform/post/list', { waitUntil: 'domcontentloaded', timeout: 8000 })
            await new Promise(resolve => setTimeout(resolve, 300))
          } catch (e) {
            logger.warn('[account] Navigation failed:', e)
          }

          // Try to trigger API calls that set cookies
          try {
            await page.evaluate(() => {
              return fetch('/cgi-bin/mmfinderassistant-bin/auth/auth_data', {
                credentials: 'include'
              }).catch(() => {})
            })
            await new Promise(resolve => setTimeout(resolve, 300))
          } catch (e) {
            logger.warn('[account] Cookie trigger failed:', e)
          }

          // Log current URL and page state
          try {
            const currentUrl = page.url()
            logger.info(`[account] Current URL after login: ${currentUrl}`)
          } catch {
            logger.warn('[account] Could not get URL (browser may have closed)')
          }
        } else {
          logger.warn('[account] Browser closed before cookie stabilization, will try to save existing cookies')
        }

        // Save cookies — wrapped in try-catch because browser may have closed
        try {
          const cookies = await context.cookies()
          const domains = [...new Set(cookies.map(c => c.domain))]
          const cookieNames = cookies.map(c => c.name)
          logger.info(`[account] Cookies in context: ${cookies.length}, domains: ${domains.join(', ')}`)
          logger.info(`[account] Cookie names: ${cookieNames.join(', ')}`)

          if (cookies.length > 0) {
            await cookieStore.saveCookies(accountId!, context)
            repo.updateSession(accountId!, 'logged_in', undefined, result.displayName)
            saveDatabase()
            logger.info('[account] Cookies saved successfully')
          } else {
            logger.warn('[account] No cookies found — login session may not persist')
            repo.updateSession(accountId!, 'logged_in', undefined, result.displayName)
            saveDatabase()
          }
        } catch (e) {
          logger.warn('[account] Cookie save failed (browser may have closed):', e)
          repo.updateSession(accountId!, 'logged_in', undefined, result.displayName)
          saveDatabase()
        }
      }

      await browserManager.close()

      return {
        success: result.success,
        data: { accountId, displayName: result.displayName, avatarUrl: result.avatarUrl }
      }
    } catch (err) {
      logger.error('ACCOUNT_LOGIN error:', err)
      await browserManager.close()
      return { success: false, error: String(err) }
    }
  })

  // Check session status
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_CHECK_SESSION, async (_event, accountId: string): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const account = repo.getById(accountId)
      if (!account) return { success: false, error: '账号不存在' }

      const adapter = getAdapter(account.platform)
      if (!adapter) return { success: false, error: `不支持的平台: ${account.platform}` }

      const context = await browserManager.getContext(account.platform)
      await cookieStore.loadCookies(context, accountId)
      const isValid = await adapter.checkSession(context)

      const newStatus = isValid ? 'logged_in' : 'expired'
      repo.updateSession(accountId, newStatus)
      saveDatabase()

      await browserManager.close()
      return { success: true, data: { sessionStatus: newStatus } }
    } catch (err) {
      logger.error('ACCOUNT_CHECK_SESSION error:', err)
      await browserManager.close()
      return { success: false, error: String(err) }
    }
  })

  // Logout
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGOUT, async (_event, accountId: string): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const account = repo.getById(accountId)
      if (!account) return { success: false, error: '账号不存在' }

      await cookieStore.clearCookies(accountId)
      await browserManager.close()

      return { success: true }
    } catch (err) {
      logger.error('ACCOUNT_LOGOUT error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('Account IPC handlers registered')
}
