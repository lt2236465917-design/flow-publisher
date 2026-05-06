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
