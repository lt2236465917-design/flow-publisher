import { BrowserWindow, session } from 'electron'
import { logger } from '../../utils/logger'

/**
 * 使用Electron内置BrowserWindow进行登录
 * 每个账号使用独立 session 分区，减少 Cookie 串用和登录态污染。
 */
export class ElectronLoginWindow {
  private loginWindow: BrowserWindow | null = null
  private platformId: string
  private accountId: string

  constructor(platformId: string, accountId?: string) {
    this.platformId = platformId
    // 参考yixiaoer: 使用accountId作为partition的一部分，支持多账号
    this.accountId = accountId || `${platformId}-${Date.now()}`
  }

  /**
   * 打开登录窗口
   */
  async open(loginUrl: string): Promise<BrowserWindow> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close()
    }

    // 参考yixiaoer: 使用 persist:auth-${accountId} 作为partition
    // 每个账号独立的session，支持多账号登录和切换
    const partition = `persist:auth-${this.accountId}`

    // 清除该账号的旧session数据，确保需要重新扫码登录
    try {
      const ses = session.fromPartition(partition)
      // 先用 cookies API 逐个删除残留 cookies（clearStorageData 有时清不干净）
      const existingCookies = await ses.cookies.get({})
      for (const cookie of existingCookies) {
        const url = `http${cookie.secure ? 's' : ''}://${cookie.domain?.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`
        await ses.cookies.remove(url, cookie.name).catch(() => {})
      }
      // 再清除所有类型的存储数据
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexeddb', 'websql', 'shadercache', 'serviceworkers', 'cachestorage']
      })
      await ses.clearAuthCache()
      const remaining = await ses.cookies.get({})
      logger.info(`[ElectronLoginWindow] Cleared all storage data for account ${this.accountId}, remaining cookies: ${remaining.length}`)
    } catch (e) {
      logger.warn(`[ElectronLoginWindow] Failed to clear session: ${e}`)
    }

    this.loginWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: `登录 - ${this.getPlatformName()}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition
      }
    })

    // 为视频号设置微信浏览器的User-Agent
    if (this.platformId === 'wechat-channels') {
      const wechatUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090c11)'
      this.loginWindow.webContents.setUserAgent(wechatUA)
      logger.info(`[ElectronLoginWindow] Set WeChat UA for ${this.platformId}`)
    }

    // 确保用户手动关闭窗口时能正确清理
    // 必须在 close 事件中分离 debugger（closed 事件时窗口已销毁，太晚了）
    this.loginWindow.on('close', () => {
      logger.info(`[ElectronLoginWindow] Window closing for ${this.platformId}, detaching debugger...`)
      this.detachDebugger()
    })
    this.loginWindow.on('closed', () => {
      this.loginWindow = null
    })

    await this.loginWindow.loadURL(loginUrl)
    logger.info(`[ElectronLoginWindow] Opened login window for ${this.platformId}: ${loginUrl}`)
    return this.loginWindow
  }

  /**
   * 等待登录成功
   * 使用多种方式检测：cookie变化 + URL轮询 + 导航事件
   */
  async waitForLogin(checkDomains: string[], timeout: number = 180000): Promise<boolean> {
    if (!this.loginWindow) {
      throw new Error('Login window not opened')
    }

    // Store local reference to avoid null issues from class property changes
    const loginWin = this.loginWindow

    return new Promise((resolve) => {
      let resolved = false
      // Track navigation listeners for cleanup
      const onNavigate = (_event: any, url: string) => {
        if (resolved) return
        logger.info(`[ElectronLoginWindow] Navigate: ${url}`)
        for (const domain of checkDomains) {
          if (url.includes(domain) && !this.isLoginPage(url)) {
            logger.info(`[ElectronLoginWindow] Login detected via navigation: ${url}`)
            setTimeout(() => resolveOnce(true), 1000)
            return
          }
        }
      }

      const resolveOnce = (value: boolean) => {
        if (resolved) return
        resolved = true
        clearInterval(pollTimer)
        clearTimeout(timeoutTimer)
        // Remove cookie listener on the correct target (ses.cookies, not ses)
        try { ses.cookies.removeListener('changed', onCookieChange) } catch {}
        // Remove navigation listeners to prevent leaks
        try { loginWin.webContents.removeListener('did-navigate', onNavigate) } catch {}
        try { loginWin.webContents.removeListener('did-navigate-in-page', onNavigate) } catch {}
        resolve(value)
      }

      const timeoutTimer = setTimeout(() => {
        logger.warn(`[ElectronLoginWindow] Login timeout for ${this.platformId}`)
        this.cleanup()
        resolveOnce(false)
      }, timeout)

      // 方式1：监听cookie变化（最可靠）
      // 当平台设置登录cookie时，说明登录成功
      const ses = loginWin.webContents.session
      const cookieDomainKeywords = this.getCookieDomainKeywords()

      const onCookieChange = (_event: any, cookie: any, _cause: any, _removed: boolean) => {
        if (resolved) return
        const domain = cookie.domain || ''
        const name = cookie.name || ''
        logger.debug(`[ElectronLoginWindow] Cookie changed: ${name} @ ${domain}`)

        // 检测关键登录cookie
        for (const keyword of cookieDomainKeywords) {
          if (domain.includes(keyword) && this.isLoginCookie(name)) {
            logger.info(`[ElectronLoginWindow] Login cookie detected: ${name} @ ${domain}`)
            // 等2秒让所有cookie设置完成
            setTimeout(() => resolveOnce(true), 2000)
            return
          }
        }
      }
      ses.cookies.on('changed', onCookieChange)

      // 方式2：URL轮询（兜底）
      let lastUrl = ''
      const pollTimer = setInterval(() => {
        if (resolved || loginWin.isDestroyed()) return
        try {
          const url = loginWin.webContents.getURL()
          if (url !== lastUrl) {
            logger.info(`[ElectronLoginWindow] URL poll: ${url}`)
            lastUrl = url
          }

          // 检查URL是否包含成功页面的关键词
          for (const domain of checkDomains) {
            if (url.includes(domain) && !this.isLoginPage(url)) {
              logger.info(`[ElectronLoginWindow] Login detected via URL poll: ${url}`)
              setTimeout(() => resolveOnce(true), 1000)
              return
            }
          }
        } catch {}
      }, 1000)

      // 方式3：导航事件 (onNavigate is defined above resolveOnce for proper cleanup)
      loginWin.webContents.on('did-navigate', onNavigate)
      loginWin.webContents.on('did-navigate-in-page', onNavigate)

      // 窗口关闭
      loginWin.on('closed', () => {
        resolveOnce(false)
      })
    })
  }

  /**
   * 获取每个平台的cookie域名关键词
   */
  private getCookieDomainKeywords(): string[] {
    const map: Record<string, string[]> = {
      douyin: ['.douyin.com', 'creator.douyin.com'],
      xiaohongshu: ['.xiaohongshu.com', 'edith.xiaohongshu.com'],
      kuaishou: ['.kuaishou.com', 'cp.kuaishou.com'],
      'wechat-channels': ['channels.weixin.qq.com', 'weixin.qq.com']
    }
    return map[this.platformId] || []
  }

  /**
   * 判断是否是关键登录cookie
   * 注意：快手的 did 只是设备标识，不是登录标识
   */
  private isLoginCookie(name: string): boolean {
    const loginCookies: Record<string, string[]> = {
      douyin: ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'],
      xiaohongshu: ['a1', 'web_session', 'galaxy_creator_session_id'],
      kuaishou: ['userId', 'kuaishou.web.cp.api_st'], // 只用真正的登录cookie，kpn和api_ph可能在页面加载时就设置
      'wechat-channels': ['bizuin', 'slave_sid', 'wxsess_ticket']
    }
    const keywords = loginCookies[this.platformId] || []
    return keywords.some(k => name === k)
  }

  /**
   * 判断URL是否还是登录页面
   */
  private isLoginPage(url: string): boolean {
    const loginPagePatterns: Record<string, string[]> = {
      douyin: ['login', 'passport'],
      xiaohongshu: ['login'],
      kuaishou: ['login', 'passport'],
      'wechat-channels': ['login.html']
    }
    const patterns = loginPagePatterns[this.platformId] || []
    return patterns.some(p => url.includes(p))
  }

  /**
   * 导航到指定URL（登录后继续浏览用）
   */
  async navigateTo(url: string): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      await this.loginWindow.loadURL(url)
      logger.info(`[ElectronLoginWindow] Navigated to: ${url}`)
    }
  }

  /**
   * 启用网络请求监控（仅监控指定域名的API请求）
   */
  enableNetworkMonitor(domainFilter: string): void {
    if (!this.loginWindow || this.loginWindow.isDestroyed()) return

    this.loginWindow.webContents.on('did-start-navigation', (event: any, url: string) => {
      if (url.includes(domainFilter)) {
        logger.info(`[NET-MON] Navigation: ${url}`)
      }
    })

    // 使用 Chrome DevTools Protocol 监控网络请求
    try {
      const wc = this.loginWindow.webContents
      const dbg = wc.debugger
      if (!dbg.isAttached()) {
        dbg.attach('1.3')
      }

      // 监听 CDP 事件
      dbg.on('message', (_event: any, method: string, params: any) => {
        if (method === 'Network.requestWillBeSent') {
          const req = params.request
          const url = req.url
          if (url.includes(domainFilter) && url.includes('/cgi-bin/')) {
            logger.info(`[NET-MON] ${req.method} ${url}`)
            if (req.postData) {
              try {
                const parsed = JSON.parse(req.postData)
                logger.info(`[NET-MON] Body: ${JSON.stringify(parsed, null, 2).substring(0, 2000)}`)
              } catch {
                logger.info(`[NET-MON] Body (raw): ${req.postData.substring(0, 500)}`)
              }
            }
          }
        }
        if (method === 'Network.responseReceived') {
          const resp = params.response
          const url = resp.url
          if (url.includes(domainFilter) && url.includes('/cgi-bin/')) {
            logger.info(`[NET-MON] Response ${resp.status} ${url}`)
            // 获取响应体
            const requestId = params.requestId
            dbg.sendCommand('Network.getResponseBody', { requestId }).then((result: any) => {
              if (result.body) {
                logger.info(`[NET-MON] Resp body: ${result.body.substring(0, 3000)}`)
              }
            }).catch(() => {})
          }
        }
      })

      // 启用网络监控
      dbg.sendCommand('Network.enable').then(() => {
        logger.info(`[ElectronLoginWindow] Network monitor enabled for ${domainFilter}`)
      }).catch((e: any) => {
        logger.warn(`[ElectronLoginWindow] Failed to enable Network.enable: ${e}`)
      })
    } catch (e) {
      logger.warn(`[ElectronLoginWindow] Failed to enable network monitor: ${e}`)
    }
  }

  /**
   * 获取窗口实例（用于外部操作）
   */
  getWindow(): BrowserWindow | null {
    return this.loginWindow
  }

  /**
   * 获取cookies
   */
  async getCookies(): Promise<Array<{
    name: string
    value: string
    domain: string
    path: string
    expires: number
    httpOnly: boolean
    secure: boolean
  }>> {
    if (!this.loginWindow) return []

    const cookies = await this.loginWindow.webContents.session.cookies.get({})
    logger.info(`[ElectronLoginWindow] Got ${cookies.length} cookies for ${this.platformId}`)
    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate || -1,
      httpOnly: c.httpOnly,
      secure: c.secure
    }))
  }

  close(): void {
    this.cleanup()
  }

  private detachDebugger(): void {
    try {
      if (this.loginWindow && !this.loginWindow.isDestroyed()) {
        const dbg = this.loginWindow.webContents.debugger
        if (dbg.isAttached()) {
          dbg.detach()
          logger.info(`[ElectronLoginWindow] Debugger detached for ${this.platformId}`)
        }
      }
    } catch (e) {
      logger.warn(`[ElectronLoginWindow] Failed to detach debugger: ${e}`)
    }
  }

  private cleanup(): void {
    this.detachDebugger()
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close()
    }
    this.loginWindow = null
  }

  private getPlatformName(): string {
    const names: Record<string, string> = {
      douyin: '抖音',
      xiaohongshu: '小红书',
      kuaishou: '快手',
      'wechat-channels': '视频号'
    }
    return names[this.platformId] || this.platformId
  }
}
