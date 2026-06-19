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
import { encryptString } from '../utils/crypto-store'
import { logger } from '../utils/logger'
import {
  getMainWindow,
  registerTrustedIpcHandler
} from '../security/trusted-ipc'

const cookieStore = new CookieStore()

// Register all adapters (API mode only)
registerAdapter(new DouyinApiAdapter())
registerAdapter(new XhsApiAdapter())
registerAdapter(new WcApiAdapter())
registerAdapter(new KsApiAdapter())

export function registerAccountIpcHandlers(): void {
  // 启动时清理重复账号：每个平台只保留最新的一个
  try {
    const repo = getAccountRepository()
    const all = repo.getAll()
    const seen = new Map<string, string>() // platform -> latest id
    for (const a of all) {
      const existing = seen.get(a.platform)
      if (!existing || a.updated_at > (all.find(x => x.id === existing)?.updated_at || '')) {
        if (existing) repo.deleteById(existing)
        seen.set(a.platform, a.id)
      } else {
        repo.deleteById(a.id)
      }
    }
    const deleted = all.length - seen.size
    if (deleted > 0) {
      saveDatabase()
      logger.info(`[account] Cleaned up ${deleted} duplicate accounts`)
    }
  } catch (e) {
    logger.warn('[account] Failed to cleanup duplicate accounts:', e)
  }

  // List all accounts
  registerTrustedIpcHandler(IPC_CHANNELS.ACCOUNT_LIST, async (): Promise<IpcResponse> => {
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

  // Start login flow for a platform.
  // Use Electron BrowserWindow with an isolated session partition per account.
  registerTrustedIpcHandler(IPC_CHANNELS.ACCOUNT_LOGIN, async (event, platformId: string): Promise<IpcResponse> => {
    let loginWindow: ElectronLoginWindow | null = null
    try {
      const adapter = getAdapter(platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${platformId}` }
      }

      const repo = getAccountRepository()
      const existing = repo.getByPlatform(platformId)
      let accountId: string

      // 复用已有账号，如果不存在则创建
      if (existing.length > 0) {
        accountId = existing[0].id
        logger.info(`[account] Reusing existing account for ${platformId}: ${accountId}`)
      } else {
        const account = repo.create({ platform: platformId, displayName: adapter.platformName })
        accountId = account.id
        saveDatabase()
        logger.info(`[account] Created new account for ${platformId}: ${accountId}`)
      }

      // 使用accountId作为partition，确保session隔离
      loginWindow = new ElectronLoginWindow(platformId, accountId)

      // 使用Electron内置浏览器打开登录页面，避免共享主浏览器 Cookie
      logger.info(`[account] Opening login window for ${platformId}, accountId: ${accountId}...`)
      await loginWindow.open(adapter.loginUrl)

      // 通知渲染进程
      const mainWindow = getMainWindow() || undefined
      mainWindow?.webContents.send('account:qr-code', {
        accountId, platformId,
        qrDataUrl: null,
        fallbackMessage: '请在弹出的窗口中扫码登录'
      })

      // 根据平台确定登录成功后应该检查的域名
      const checkDomains: Record<string, string[]> = {
        douyin: ['creator.douyin.com/creator-micro'],
        xiaohongshu: ['creator.xiaohongshu.com/new', 'creator.xiaohongshu.com/publish'],
        kuaishou: [], // 快手即使未登录也会跳转/profile，不能用URL检测，完全依赖cookie检测
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
            'wechat-channels': ['.weixin.qq.com', 'channels.weixin.qq.com', 'finderassistancea.video.qq.com']
            // Note: removed .qq.com — too broad, would capture mail.qq.com, docs.qq.com, etc.
          }
          const domains = platformDomains[platformId] || []
          const filteredCookies = cookies.filter(c => {
            const cd = c.domain || ''
            // Exact match or subdomain match only (no loose includes() to prevent evil-douyin.com matching douyin.com)
            return domains.some(d => {
              if (cd === d) return true
              // d starts with '.' means it's a domain-suffix pattern like '.douyin.com'
              if (d.startsWith('.')) return cd.endsWith(d)
              // Otherwise check if cd is a subdomain of d
              return cd.endsWith('.' + d)
            })
          })
          logger.info(`[account] Filtered cookies: ${filteredCookies.length}/${cookies.length} for ${platformId}`)
          if (filteredCookies.length > 0) {
            logger.info(`[account] Filtered cookie domains: ${[...new Set(filteredCookies.map(c => c.domain))].join(', ')}`)
          }

          // 使用CookieStore保存cookies（内部加密存储 + 更新session状态）
          await cookieStore.saveCookies(accountId!, filteredCookies)
          logger.info(`[account] Cookies saved: ${filteredCookies.length} cookies (encrypted)`)

          // 获取账号名称：先尝试从页面DOM提取，再尝试API
          let displayName: string | undefined

          // 方式1：从登录页面直接提取用户名（快手等需要签名的平台用这个方式）
          try {
            const window = loginWindow.getWindow()
            if (window && !window.isDestroyed()) {
              const page = window.webContents
              displayName = await page.executeJavaScript(`
                (function() {
                  // 快手: 从页面元素提取用户名
                  var el = document.querySelector('[class*="user-name"], [class*="username"], [class*="nickname"], .profile-name, .author-name')
                  if (el && el.textContent && el.textContent.trim().length >= 2) return el.textContent.trim()
                  // 快手: 从 meta 标签提取
                  var meta = document.querySelector('meta[name="author"]')
                  if (meta && meta.content) return meta.content
                  // 通用: 从页面标题提取（很多平台在标题中显示用户名）
                  var title = document.title
                  if (title && title.includes('-')) return title.split('-')[0].trim()
                  return null
                })()
              `)
              if (displayName) {
                logger.info(`[account] Got displayName from page DOM: ${displayName}`)
              }
            }
          } catch (e) {
            logger.warn('[account] Failed to extract displayName from page:', e)
          }

          // 方式2：通过API获取账号信息
          if (!displayName) {
            try {
              const cookieStr = filteredCookies.map(c => `${c.name}=${c.value}`).join('; ')
              logger.info(`[account] Calling getAccountInfoAPI with ${filteredCookies.length} filtered cookies`)
              const apiClient = new HttpClient({ cookies: cookieStr, platform: platformId, accountId: accountId! })
              if ('getAccountInfoAPI' in adapter && typeof (adapter as any).getAccountInfoAPI === 'function') {
                const apiInfo = await (adapter as any).getAccountInfoAPI(apiClient)
                logger.info(`[account] getAccountInfoAPI result: ${JSON.stringify(apiInfo)}`)
                if (apiInfo?.displayName) {
                  displayName = apiInfo.displayName
                }
              }
            } catch (e) {
              logger.warn('[account] Failed to get account name via API:', e)
            }
          }

          // 更新账号名称（使用加密存储的 filtered cookies，不覆盖为未过滤的原始 cookies）
          if (displayName) {
            const encrypted = encryptString(JSON.stringify(filteredCookies))
            repo.updateSession(accountId!, 'logged_in', encrypted, displayName)
            saveDatabase()
            logger.info(`[account] Account name updated: ${displayName}`)
          } else {
            logger.warn('[account] Could not get displayName from any source')
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
      loginWindow?.close()
      return { success: false, error: String(err) }
    }
  })

  // Check session status — call platform API to verify real login status
  registerTrustedIpcHandler(IPC_CHANNELS.ACCOUNT_CHECK_SESSION, async (_event, accountId: string): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const account = repo.getById(accountId)
      if (!account) return { success: false, error: '账号不存在' }

      const cookieStr = await cookieStore.getCookieStringWithSessionFallback(accountId)
      if (!cookieStr || account.session_status !== 'logged_in') {
        return { success: true, data: { sessionStatus: 'not_logged_in' } }
      }

      // 调用平台 API 验证真实的登录状态
      const adapter = getAdapter(account.platform)
      if (!adapter) {
        return { success: true, data: { sessionStatus: 'logged_in' } }
      }

      try {
        const apiClient = new HttpClient({ cookies: cookieStr, platform: account.platform, accountId })

        // 使用 checkSessionAPI 验证登录状态
        if (adapter.checkSessionAPI) {
          const isValid = await adapter.checkSessionAPI(apiClient)
          logger.info(`[account] API session check for ${account.platform}: ${isValid ? 'valid' : 'expired'}`)

          if (!isValid) {
            // API 验证失败，更新状态为 expired
            repo.updateSession(accountId, 'expired', cookieStr)
            saveDatabase()
            return { success: true, data: { sessionStatus: 'expired' } }
          }
        }

        // 如果登录成功但 displayName 还是默认平台名，尝试通过 API 重新获取
        if (!account.display_name || account.display_name === adapter.platformName) {
          try {
            if ('getAccountInfoAPI' in adapter && typeof (adapter as any).getAccountInfoAPI === 'function') {
              const apiInfo = await (adapter as any).getAccountInfoAPI(apiClient)
              if (apiInfo?.displayName) {
                repo.updateSession(accountId, 'logged_in', cookieStr, apiInfo.displayName)
                saveDatabase()
                logger.info(`[account] Refreshed displayName via checkSession: ${apiInfo.displayName}`)
                return { success: true, data: { sessionStatus: 'logged_in', displayName: apiInfo.displayName } }
              }
            }
          } catch (e) {
            logger.warn('[account] Failed to refresh displayName during checkSession:', e)
          }
        }

        return { success: true, data: { sessionStatus: 'logged_in' } }
      } catch (apiErr) {
        // API 调用失败（可能是签名问题），保持当前状态但记录警告
        logger.warn(`[account] API check failed for ${account.platform}, keeping current status:`, apiErr)
        return { success: true, data: { sessionStatus: account.session_status } }
      }
    } catch (err) {
      logger.error('ACCOUNT_CHECK_SESSION error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Batch check all logged-in accounts (for startup auto-check)
  registerTrustedIpcHandler(IPC_CHANNELS.ACCOUNT_CHECK_ALL_SESSIONS, async (): Promise<IpcResponse> => {
    try {
      const repo = getAccountRepository()
      const allAccounts = repo.getAll()
      const loggedInAccounts = allAccounts.filter(a => a.session_status === 'logged_in')

      logger.info(`[account] Auto-checking ${loggedInAccounts.length} logged-in accounts...`)

      const results: Array<{ accountId: string; platform: string; sessionStatus: string }> = []

      for (const account of loggedInAccounts) {
        try {
          const cookieStr = await cookieStore.getCookieStringWithSessionFallback(account.id)
          if (!cookieStr) {
            // An unreadable safeStorage payload is not proof that the remote
            // session expired. Never destroy credentials during a health check.
            results.push({ accountId: account.id, platform: account.platform, sessionStatus: account.session_status })
            continue
          }

          const adapter = getAdapter(account.platform)
          if (!adapter?.checkSessionAPI) {
            results.push({ accountId: account.id, platform: account.platform, sessionStatus: 'logged_in' })
            continue
          }

          const apiClient = new HttpClient({ cookies: cookieStr, platform: account.platform, accountId: account.id })
          const isValid = await adapter.checkSessionAPI(apiClient)

          if (!isValid) {
            repo.updateSession(account.id, 'expired', cookieStr)
            results.push({ accountId: account.id, platform: account.platform, sessionStatus: 'expired' })
            logger.info(`[account] ${account.platform} session expired`)
          } else {
            results.push({ accountId: account.id, platform: account.platform, sessionStatus: 'logged_in' })
            logger.info(`[account] ${account.platform} session valid`)
          }
        } catch (e) {
          logger.warn(`[account] Failed to check ${account.platform}:`, e)
          results.push({ accountId: account.id, platform: account.platform, sessionStatus: account.session_status })
        }
      }

      saveDatabase()
      return { success: true, data: results }
    } catch (err) {
      logger.error('ACCOUNT_CHECK_ALL_SESSIONS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Logout
  registerTrustedIpcHandler(IPC_CHANNELS.ACCOUNT_LOGOUT, async (_event, accountId: string): Promise<IpcResponse> => {
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
