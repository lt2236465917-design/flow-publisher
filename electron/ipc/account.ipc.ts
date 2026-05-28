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
import { HttpClient } from '../services/http/HttpClient'
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

      // Close existing browser and delete profile for a truly clean login
      await browserManager.close()
      browserManager.setCleanLaunch()
      const context = await browserManager.getContext(platformId)
      try {
        await browserManager.clearAllCookies()
      } catch {
        // Context may have been recreated
      }
      const page = await adapter.startLogin(context)

      // Notify renderer: user should scan QR in the browser window
      logger.info('[account] Browser opened, waiting for user to scan QR in browser...')
      const mainWindow = BrowserWindow.getAllWindows()[0]
      mainWindow?.webContents.send('account:qr-code', {
        accountId, platformId,
        qrDataUrl: null,
        fallbackMessage: '请在弹出的浏览器窗口中扫码登录'
      })

      // Wait for login result (detects QR disappearance in browser)
      logger.info('[account] Waiting for login result...')
      const result: LoginResult = await adapter.waitForLoginResult(page)

      if (result.success) {
        logger.info('[account] Login successful, saving cookies via CDP')

        try {
          // Navigate to trigger more cookie setting
          try {
            await page.goto('https://channels.weixin.qq.com/platform/post/list', { waitUntil: 'domcontentloaded', timeout: 5000 })
          } catch {}

          // Use CDP to get all cookies (Playwright's context.cookies() returns 0 for persistent contexts)
          const cdpCookies = await browserManager.getAllCookiesViaCDP(page)
          logger.info(`[account] CDP cookies: ${cdpCookies.length} | names: ${cdpCookies.map(c => c.name).join(', ')}`)

          if (cdpCookies.length > 0) {
            // Convert CDP cookies to Playwright format and save
            const pwCookies = cdpCookies.map(c => ({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: -1,
              httpOnly: false,
              secure: false,
              sameSite: 'Lax' as const
            }))
            const cookieJson = JSON.stringify(pwCookies)
            repo.updateSession(accountId!, 'logged_in', cookieJson, result.displayName)
            saveDatabase()
            logger.info(`[account] Cookies saved: ${cdpCookies.length} cookies`)

            // Try to get real account name via API
            try {
              // Convert cookie JSON to name=value format for HTTP headers
              const parsedCookies = JSON.parse(cookieJson)
              const cookieStr = parsedCookies.map((c: any) => `${c.name}=${c.value}`).join('; ')
              const apiClient = new HttpClient({ cookies: cookieStr, platform: platformId, accountId: accountId! })
              const apiInfo = await (adapter as WcApiAdapter).getAccountInfoAPI(apiClient)
              if (apiInfo?.displayName) {
                repo.updateSession(accountId!, 'logged_in', cookieJson, apiInfo.displayName)
                saveDatabase()
                logger.info(`[account] Account name updated via API: ${apiInfo.displayName}`)
                result.displayName = apiInfo.displayName
              }
            } catch (e) {
              logger.warn('[account] Failed to get account name via API:', e)
            }
          } else {
            logger.warn('[account] No cookies found via CDP')
            repo.updateSession(accountId!, 'logged_in', undefined, result.displayName)
            saveDatabase()
          }
        } catch (e) {
          logger.warn('[account] Cookie save failed:', e)
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
