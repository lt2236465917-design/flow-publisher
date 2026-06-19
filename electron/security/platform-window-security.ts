import type { BrowserWindow, Event } from 'electron'
import { logger } from '../utils/logger'
import { isAllowedPlatformNavigation } from './navigation-policy'

const PLATFORM_HOST_SUFFIXES: Record<string, string[]> = {
  douyin: ['douyin.com', 'bytedance.com', 'byteimg.com', 'snssdk.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhscdn.com'],
  kuaishou: ['kuaishou.com', 'kuaishouzt.com'],
  'wechat-channels': ['weixin.qq.com', 'qq.com', 'wechat.com']
}

export function getPlatformHostSuffixes(platform: string): string[] {
  return PLATFORM_HOST_SUFFIXES[platform] || []
}

export function hardenPlatformWindow(
  window: BrowserWindow,
  platform: string
): void {
  const allowedHosts = getPlatformHostSuffixes(platform)
  const guard = (event: Event, url: string): void => {
    if (!isAllowedPlatformNavigation(url, allowedHosts)) {
      event.preventDefault()
      logger.warn(`[security] Blocked ${platform} window navigation to ${url}`)
    }
  }

  window.webContents.on('will-navigate', guard)
  window.webContents.on('will-redirect', guard)
  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn(`[security] Blocked ${platform} window open request to ${url}`)
    return { action: 'deny' }
  })
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  )
}
