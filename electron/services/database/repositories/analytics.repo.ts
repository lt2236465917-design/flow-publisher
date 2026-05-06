import type { Database } from 'sql.js'
import type {
  AnalyticsQuery,
  AnalyticsOverview,
  PlatformStats,
  DailyTrend,
  StatusDistribution,
  PlatformCompareItem
} from '../../../shared/contracts/analytics.contract'

export interface AnalyticsSnapshotRow {
  id: string
  record_id: string
  platform: string
  views: number
  likes: number
  comments: number
  shares: number
  followers: number
  snapshot_at: string
}

export class AnalyticsRepository {
  constructor(private db: Database) {}

  private buildDateFilter(query: AnalyticsQuery): { clause: string; params: string[] } {
    if (query.startDate && query.endDate) {
      return { clause: 'AND created_at >= ? AND created_at <= ?', params: [query.startDate, query.endDate] }
    }

    const now = new Date()
    let daysBack = 0
    switch (query.timeRange) {
      case '7d':
        daysBack = 7
        break
      case '30d':
        daysBack = 30
        break
      case '90d':
        daysBack = 90
        break
      case 'all':
        return { clause: '', params: [] }
    }

    const startDate = new Date(now.getTime() - daysBack * 86400000).toISOString()
    return { clause: 'AND created_at >= ?', params: [startDate] }
  }

  getOverview(query: AnalyticsQuery): AnalyticsOverview {
    const { clause, params } = this.buildDateFilter(query)

    // Platform stats
    const platformStats = this.getPlatformStats(clause, params)
    const dailyTrends = this.getDailyTrends(clause, params)
    const statusDistribution = this.getStatusDistribution(clause, params)

    // Totals
    const totalStmt = this.db.prepare(`SELECT COUNT(*) as cnt FROM publish_records WHERE 1=1 ${clause}`)
    if (params.length) totalStmt.bind(params)
    totalStmt.step()
    const totalPublishes = (totalStmt.getAsObject() as { cnt: number }).cnt
    totalStmt.free()

    const successCount = statusDistribution.find((s) => s.status === 'done')?.count || 0
    const failedCount = statusDistribution.find((s) => s.status === 'error')?.count || 0
    const pendingCount = statusDistribution.find((s) => s.status === 'pending')?.count || 0
    const successRate = totalPublishes > 0 ? Math.round((successCount / totalPublishes) * 100) : 0

    return {
      totalPublishes,
      successCount,
      failedCount,
      pendingCount,
      successRate,
      platformStats,
      dailyTrends,
      statusDistribution
    }
  }

  getPlatformStats(clause: string, params: string[]): PlatformStats[] {
    const stmt = this.db.prepare(`
      SELECT
        platform,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('pending', 'uploading', 'uploaded', 'submitting') THEN 1 ELSE 0 END) as pending
      FROM publish_records
      WHERE 1=1 ${clause}
      GROUP BY platform
      ORDER BY total DESC
    `)
    if (params.length) stmt.bind(params)

    const rows: PlatformStats[] = []
    while (stmt.step()) {
      const obj = stmt.getAsObject() as { platform: string; total: number; success: number; failed: number; pending: number }
      rows.push({
        platform: obj.platform,
        total: obj.total,
        success: obj.success,
        failed: obj.failed,
        pending: obj.pending,
        successRate: obj.total > 0 ? Math.round((obj.success / obj.total) * 100) : 0
      })
    }
    stmt.free()
    return rows
  }

  getDailyTrends(clause: string, params: string[]): DailyTrend[] {
    const stmt = this.db.prepare(`
      SELECT
        date(created_at) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed
      FROM publish_records
      WHERE 1=1 ${clause}
      GROUP BY date(created_at)
      ORDER BY date ASC
    `)
    if (params.length) stmt.bind(params)

    const rows: DailyTrend[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as DailyTrend)
    }
    stmt.free()
    return rows
  }

  getStatusDistribution(clause: string, params: string[]): StatusDistribution[] {
    const stmt = this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM publish_records
      WHERE 1=1 ${clause}
      GROUP BY status
    `)
    if (params.length) stmt.bind(params)

    const rows: StatusDistribution[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as StatusDistribution)
    }
    stmt.free()
    return rows
  }

  comparePlatforms(query: AnalyticsQuery): PlatformCompareItem[] {
    const { clause, params } = this.buildDateFilter(query)
    const stats = this.getPlatformStats(clause, params)

    return stats.map((s) => ({
      platform: s.platform,
      total: s.total,
      success: s.success,
      failed: s.failed,
      successRate: s.successRate,
      avgProgress: 0
    }))
  }

  // Analytics snapshots methods
  getSnapshotsByRecord(recordId: string): AnalyticsSnapshotRow[] {
    const stmt = this.db.prepare('SELECT * FROM analytics_snapshots WHERE record_id = ? ORDER BY snapshot_at DESC')
    stmt.bind([recordId])
    const rows: AnalyticsSnapshotRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as AnalyticsSnapshotRow)
    }
    stmt.free()
    return rows
  }

  createSnapshot(data: {
    recordId: string
    platform: string
    views?: number
    likes?: number
    comments?: number
    shares?: number
    followers?: number
  }): void {
    const { v4: uuidv4 } = require('uuid')
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO analytics_snapshots (id, record_id, platform, views, likes, comments, shares, followers, snapshot_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        data.recordId,
        data.platform,
        data.views || 0,
        data.likes || 0,
        data.comments || 0,
        data.shares || 0,
        data.followers || 0,
        now
      ]
    )
  }
}
