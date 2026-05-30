import { BrowserWindow, session } from 'electron'
import { logger } from '../../utils/logger'

/**
 * 使用Electron内置BrowserWindow进行登录
 * 这种方式与yixiaoer相同，不会被检测为自动化工具
 */
export class ElectronLoginWindow {
  private loginWindow: BrowserWindow | null = null
  private platformId: string

  constructor(platformId: string) {
    this.platformId = platformId
  }

  /**
   * 打开登录窗口
   */
  async open(loginUrl: string): Promise<BrowserWindow> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close()
    }

    this.loginWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: `登录 - ${this.getPlatformName()}`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    // 为视频号设置微信浏览器的User-Agent
    if (this.platformId === 'wechat-channels') {
      const wechatUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090c11)'
      this.loginWindow.webContents.setUserAgent(wechatUA)
      logger.info(`[ElectronLoginWindow] Set WeChat UA for ${this.platformId}`)
    }

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

    return new Promise((resolve) => {
      let resolved = false
      const resolveOnce = (value: boolean) => {
        if (resolved) return
        resolved = true
        clearInterval(pollTimer)
        clearTimeout(timeoutTimer)
        try { ses.removeListener('changed', onCookieChange) } catch {}
        resolve(value)
      }

      const timeoutTimer = setTimeout(() => {
        logger.warn(`[ElectronLoginWindow] Login timeout for ${this.platformId}`)
        this.cleanup()
        resolveOnce(false)
      }, timeout)

      // 方式1：监听cookie变化（最可靠）
      // 当平台设置登录cookie时，说明登录成功
      const ses = this.loginWindow.webContents.session
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
        if (resolved || !this.loginWindow || this.loginWindow.isDestroyed()) return
        try {
          const url = this.loginWindow.webContents.getURL()
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

      // 方式3：导航事件
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

      this.loginWindow.webContents.on('did-navigate', onNavigate)
      this.loginWindow.webContents.on('did-navigate-in-page', onNavigate)

      // 窗口关闭
      this.loginWindow.on('closed', () => {
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
   */
  private isLoginCookie(name: string): boolean {
    const loginCookies: Record<string, string[]> = {
      douyin: ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'],
      xiaohongshu: ['a1', 'web_session', 'galaxy_creator_session_id'],
      kuaishou: ['did', 'kpn', 'kuaishou_s_v3', 'userId'],
      'wechat-channels': ['bizuin', 'slave_sid', 'wxsess_ticket']
    }
    const keywords = loginCookies[this.platformId] || []
    return keywords.some(k => name === k || name.includes(k))
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

  private cleanup(): void {
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
