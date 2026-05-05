export const PLATFORM_IDS = ['douyin', 'xiaohongshu', 'wechat-channels', 'kuaishou'] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

export interface PlatformInfo {
  id: PlatformId
  displayName: string
  color: string
  icon: string
}

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  douyin: {
    id: 'douyin',
    displayName: '抖音',
    color: '#000000',
    icon: '🎵'
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    displayName: '小红书',
    color: '#ff2442',
    icon: '📕'
  },
  'wechat-channels': {
    id: 'wechat-channels',
    displayName: '视频号',
    color: '#07c160',
    icon: '🟢'
  },
  kuaishou: {
    id: 'kuaishou',
    displayName: '快手',
    color: '#ff6600',
    icon: '🟠'
  }
}

export const PLATFORM_LIST = PLATFORM_IDS.map((id) => PLATFORMS[id])
