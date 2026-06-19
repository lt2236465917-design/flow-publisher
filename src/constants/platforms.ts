import douyinIcon from '@/assets/platforms/douyin.png'
import xiaohongshuIcon from '@/assets/platforms/xhs.png'
import wechatChannelsIcon from '@/assets/platforms/wc.png'
import kuaishouIcon from '@/assets/platforms/ks.png'

export const PLATFORM_IDS = ['douyin', 'xiaohongshu', 'wechat-channels', 'kuaishou'] as const

export type PlatformId = (typeof PLATFORM_IDS)[number]

export interface PlatformInfo {
  id: PlatformId
  displayName: string
  color: string
  iconUrl: string
}

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  douyin: {
    id: 'douyin',
    displayName: '抖音',
    color: '#000000',
    iconUrl: douyinIcon
  },
  xiaohongshu: {
    id: 'xiaohongshu',
    displayName: '小红书',
    color: '#ff2442',
    iconUrl: xiaohongshuIcon
  },
  'wechat-channels': {
    id: 'wechat-channels',
    displayName: '视频号',
    color: '#07c160',
    iconUrl: wechatChannelsIcon
  },
  kuaishou: {
    id: 'kuaishou',
    displayName: '快手',
    color: '#ff6600',
    iconUrl: kuaishouIcon
  }
}

export const PLATFORM_LIST = PLATFORM_IDS.map((id) => PLATFORMS[id])
