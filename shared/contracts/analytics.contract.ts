// Shared analytics contract types used by both main and renderer processes

export type TimeRange = '7d' | '30d' | '90d' | 'all'

export interface AnalyticsQuery {
  timeRange: TimeRange
  startDate?: string
  endDate?: string
}

export interface PlatformStats {
  platform: string
  total: number
  success: number
  failed: number
  pending: number
  successRate: number
}

export interface DailyTrend {
  date: string
  total: number
  success: number
  failed: number
}

export interface StatusDistribution {
  status: string
  count: number
}

export interface AnalyticsOverview {
  totalPublishes: number
  successCount: number
  failedCount: number
  pendingCount: number
  successRate: number
  platformStats: PlatformStats[]
  dailyTrends: DailyTrend[]
  statusDistribution: StatusDistribution[]
}

export interface PlatformCompareItem {
  platform: string
  total: number
  success: number
  failed: number
  successRate: number
  avgProgress: number
}

export type AnalyticsCompareResult = PlatformCompareItem[]

// ---- 视频分组相关类型 ----

export interface VideoGroupQuery {
  timeRange?: TimeRange
  platform?: string
  sortBy?: 'created_at' | 'total_views'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

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

export interface VideoGroupListResult {
  groups: VideoGroupSummary[]
  total: number
  page: number
  pageSize: number
}

export interface TrendPoint {
  views: number
  likes: number
  comments: number
  shares: number
  followers: number
  snapshotAt: string
}

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

export interface VideoGroupDetail {
  groupId: string
  title: string
  videoPath: string
  coverPath?: string
  createdAt: string
  records: VideoGroupRecordDetail[]
}

// ---- 采集结果 ----

export interface CollectResult {
  totalRecords: number
  updatedRecords: number
  newSnapshots: number
  errors: string[]
}
