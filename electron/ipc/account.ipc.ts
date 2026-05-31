import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAccountRepository, saveDatabase } from '../services/database'
import { CookieStore } from '../services/browser/CookieStore'
import { ElectronLoginWindow } from '../services/browser/ElectronLoginWindow'
import { getAdapter } from '../services/platform-adapters/PlatformAdapterRegistry'
import { registerAdapter } from '../services/platform-adapters/PlatformAdapterRegistry'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { DouyinApiAdapter } from '../services/platform-adapters/douyin/DouyinApiAdapter'
import { XhsApiAdapter } from '../services/platform-adapters/xiaohongshu/XhsApiAdapter'
import { WcApiAdapter } from '../services/platform-adapters/wechat-channels/WcApiAdapter'
import { KsApiAdapter } from '../services/platform-adapters/kuaishou/KsApiAdapter'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import { HttpClient } from '../services/http/HttpClient'
import { logger } from '../utils/logger'

const cookieStore = new CookieStore()

// Register all adapters (API mode only)
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
  // 使用Electron内置BrowserWindow进行登录，与yixiaoer相同方式，不会被检测为自动化
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_LOGIN, async (event, platformId: string): Promise<IpcResponse> => {
    const loginWindow = new ElectronLoginWindow(platformId)

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

      // 使用Electron内置浏览器打开登录页面（与yixiaoer相同方式）
      logger.info(`[account] Opening login window for ${platformId}...`)
      await loginWindow.open(adapter.loginUrl)

      // 通知渲染进程
      const mainWindow = BrowserWindow.getAllWindows()[0]
      mainWindow?.webContents.send('account:qr-code', {
        accountId, platformId,
        qrDataUrl: null,
        fallbackMessage: '请在弹出的窗口中扫码登录'
      })

      // 根据平台确定登录成功后应该检查的域名
      const checkDomains: Record<string, string[]> = {
        douyin: ['creator.douyin.com/creator-micro'],
        xiaohongshu: ['creator.xiaohongshu.com/new', 'creator.xiaohongshu.com/publish'],
        kuaishou: ['cp.kuaishou.com/profile', 'cp.kuaishou.com/article'],
        'wechat-channels': ['channels.weixin.qq.com/platform']
      }
      const domains = checkDomains[platformId] || []

      // 等待登录成功（cookie变化 + URL轮询 + 导航事件 三重检测）
      logger.info(`[account] Waiting for login to complete (check domains: ${domains.join(', ')})...`)
      const loginSuccess = await loginWindow.waitForLogin(domains, 180000) // 3分钟超时

      if (loginSuccess) {
        logger.info('[account] Login successful, getting cookies...')

        // 获取cookies（从Electron的session中获取，不是从Playwright）
        const cookies = await loginWindow.getCookies()
        logger.info(`[account] Got ${cookies.length} cookies from Electron session`)

        if (cookies.length > 0) {
          // 只保存当前平台的cookies，过滤掉其他平台的
          const platformDomains: Record<string, string[]> = {
            douyin: ['.douyin.com', 'creator.douyin.com'],
            xiaohongshu: ['.xiaohongshu.com', 'edith.xiaohongshu.com', 'creator.xiaohongshu.com'],
            kuaishou: ['.kuaishou.com', 'cp.kuaishou.com'],
            'wechat-channels': ['.qq.com', 'weixin.qq.com', 'channels.weixin.qq.com']
          }
          const domains = platformDomains[platformId] || []
          const filteredCookies = cookies.filter(c => {
            const cd = c.domain || ''
            return domains.some(d => cd === d || cd.endsWith(d) || d.endsWith(cd) || cd.includes(d) || d.includes(cd))
          })
          logger.info(`[account] Filtered cookies: ${filteredCookies.length}/${cookies.length} for ${platformId}`)
          if (filteredCookies.length > 0) {
            logger.info(`[account] Filtered cookie domains: ${[...new Set(filteredCookies.map(c => c.domain))].join(', ')}`)
          }

          // 使用CookieStore保存cookies
          await cookieStore.saveCookies(accountId!, filteredCookies)
          logger.info(`[account] Cookies saved: ${filteredCookies.length} cookies`)

          // 尝试通过API获取账号信息（只用过滤后的平台cookie，避免旧cookie冲突）
          try {
            const cookieStr = filteredCookies.map(c => `${c.name}=${c.value}`).join('; ')
            logger.info(`[account] Calling getAccountInfoAPI with ${filteredCookies.length} filtered cookies`)
            const apiClient = new HttpClient({ cookies: cookieStr, platform: platformId, accountId: accountId! })
            if ('getAccountInfoAPI' in adapter && typeof (adapter as any).getAccountInfoAPI === 'function') {
              const apiInfo = await (adapter as any).getAccountInfoAPI(apiClient)
              logger.info(`[account] getAccountInfoAPI result: ${JSON.stringify(apiInfo)}`)
              if (apiInfo?.displayName) {
                repo.updateSession(accountId!, 'logged_in', JSON.stringify(cookies), apiInfo.displayName)
                saveDatabase()
                logger.info(`[account] Account name updated via API: ${apiInfo.displayName}`)
              } else {
                logger.warn('[account] getAccountInfoAPI returned no displayName, keeping old name')
              }
            }
          } catch (e) {
            logger.warn('[account] Failed to get account name via API:', e)
          }

          loginWindow.close()

          return {
            success: true,
            data: { accountId, displayName: repo.getById(accountId!)?.display_name }
          }
        } else {
          logger.warn('[account] No cookies found')
          loginWindow.close()
          return { success: false, error: '未获取到登录信息' }
        }
      } else {
        loginWindow.close()
        return { success: false, error: '登录超时或取消' }
      }
    } catch (err) {
      logger.error('ACCOUNT_LOGIN error:', err)
      loginWindow.close()
      return { success: false, error: String(err) }
    }
  })

  // Check session status — only check if cookies exist, don't call API
  // API calls during check may fail due to signature issues and cause false "expired" status
  ipcMain.handle(IPC_CHANNELS.ACCOUNT_CHECK_SESSION, async (_event, accountId: string): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const account = repo.getById(accountId)
      if (!account) return { success: false, error: '账号不存在' }

      // Simple check: if cookies exist, consider session valid
      // The actual session validity will be determined when publishing (API call)
      const cookieStr = cookieStore.getCookieString(accountId)
      const isValid = !!cookieStr && account.session_status === 'logged_in'

      logger.info(`[account] Session check for ${account.platform}: ${isValid ? 'valid' : 'no cookies'}`)

      return { success: true, data: { sessionStatus: isValid ? 'logged_in' : 'expired' } }
    } catch (err) {
      logger.error('ACCOUNT_CHECK_SESSION error:', err)
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

      return { success: true }
    } catch (err) {
      logger.error('ACCOUNT_LOGOUT error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('Account IPC handlers registered')
}
