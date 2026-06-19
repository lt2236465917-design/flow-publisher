/**
 * 视频数据采集相关类型定义
 */

/** 平台视频列表获取结果 */
export interface VideoListResult {
  items: VideoListItem[]
  cursor: string
  hasMore: boolean
}

/** 平台视频列表中的单条记录 */
export interface VideoListItem {
  contentId: string
  title: string
  coverUrl?: string
  publishTime: number // unix timestamp (seconds)
  views: number
  likes: number
  comments: number
  shares: number
  favorites?: number
}

/** 单个视频的详细数据 */
export interface VideoDetailResult {
  contentId: string
  title: string
  views: number
  likes: number
  comments: number
  shares: number
  favorites?: number
  followerChange?: number
}

/** 发布结果（包含平台内容ID） */
export interface SubmitResult {
  contentId?: string
  publishUrl?: string
  /** False means the platform accepted the request but did not return a final platform content ID. */
  confirmed?: boolean
}

/** 数据采集结果 */
export interface CollectResult {
  totalRecords: number
  updatedRecords: number
  newSnapshots: number
  errors: string[]
}

/** 视频分组摘要（同一视频的多平台汇总） */
export interface VideoGroupSummary {
  groupId: string
  title: string
  videoPath: string
  coverPath?: string
  createdAt: string
  platforms: VideoGroupPlatformSummary[]
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
}

/** 视频分组中单个平台的摘要 */
export interface VideoGroupPlatformSummary {
  platform: string
  recordId: string
  contentId?: string
  status: string
  views: number
  likes: number
  comments: number
  shares: number
  lastSnapshotAt?: string
}

/** 视频分组详情 */
export interface VideoGroupDetail {
  groupId: string
  title: string
  videoPath: string
  coverPath?: string
  createdAt: string
  records: VideoGroupRecordDetail[]
}

/** 视频分组中单条记录的详情 */
export interface VideoGroupRecordDetail {
  recordId: string
  platform: string
  accountId: string
  contentId?: string
  title: string
  description: string
  status: string
  publishUrl?: string
  createdAt: string
  latestSnapshot?: {
    views: number
    likes: number
    comments: number
    shares: number
    followers: number
    snapshotAt: string
  }
  trend: TrendPoint[]
}

/** 趋势数据点 */
export interface TrendPoint {
  views: number
  likes: number
  comments: number
  shares: number
  followers: number
  snapshotAt: string
}
