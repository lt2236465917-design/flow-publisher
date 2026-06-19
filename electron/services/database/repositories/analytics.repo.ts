import type { Database } from 'sql.js'
import type {
  AnalyticsQuery,
  AnalyticsOverview,
  PlatformStats,
  DailyTrend,
  StatusDistribution,
  PlatformCompareItem,
  VideoGroupSummary,
  VideoGroupPlatformSummary,
  VideoGroupDetail,
  VideoGroupRecordDetail,
  TrendPoint,
  VideoGroupQuery,
  VideoGroupListResult
} from '../../../../shared/contracts/analytics.contract'

// Use '||' (double-pipe) as separator — pipe is not valid in any OS file path,
// avoiding false splits on paths like C:\Users\test_videos\demo.mp4.
const GROUP_SEPARATOR = '||'

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
    const pendingStatuses = new Set(['pending', 'uploading', 'uploaded', 'submitting', 'unconfirmed'])
    const pendingCount = statusDistribution
      .filter((s) => pendingStatuses.has(s.status))
      .reduce((sum, s) => sum + s.count, 0)
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
        SUM(CASE WHEN status IN ('pending', 'uploading', 'uploaded', 'submitting', 'unconfirmed') THEN 1 ELSE 0 END) as pending
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

  // ---- content_id 管理 ----

  /** 更新 publish_records 的 content_id（平台端视频ID） */
  updateRecordContentId(recordId: string, contentId: string): void {
    this.db.run('UPDATE publish_records SET content_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [contentId, recordId])
  }

  /** 获取 publish_records 的 content_id */
  getRecordContentId(recordId: string): string | null {
    const stmt = this.db.prepare('SELECT content_id FROM publish_records WHERE id = ?')
    stmt.bind([recordId])
    let contentId: string | null = null
    if (stmt.step()) {
      const obj = stmt.getAsObject() as { content_id: string | null }
      contentId = obj.content_id
    }
    stmt.free()
    return contentId
  }

  // ---- 视频分组管理 ----

  /** 创建视频分组 */
  createVideoGroup(data: { title: string; videoPath: string; coverPath?: string }): string {
    const { v4: uuidv4 } = require('uuid')
    const id = uuidv4()
    this.db.run(
      `INSERT INTO video_groups (id, title, video_path, cover_path) VALUES (?, ?, ?, ?)`,
      [id, data.title, data.videoPath, data.coverPath || null]
    )
    return id
  }

  /** 将 publish_record 关联到视频分组 */
  addRecordToGroup(recordId: string, groupId: string): void {
    this.db.run('UPDATE publish_records SET group_id = ? WHERE id = ?', [groupId, recordId])
  }

  /** 获取视频分组列表（含各平台数据汇总） */
  getVideoGroups(query: VideoGroupQuery = {}): VideoGroupListResult {
    const page = query.page || 1
    const pageSize = query.pageSize || 20
    const offset = (page - 1) * pageSize

    // 构建筛选条件
    let whereClause = 'WHERE pr.status = \'done\''
    const params: unknown[] = []

    if (query.platform) {
      whereClause += ' AND pr.platform = ?'
      params.push(query.platform)
    }

    if (query.timeRange && query.timeRange !== 'all') {
      const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
      const days = daysMap[query.timeRange] || 30
      const startDate = new Date(Date.now() - days * 86400000).toISOString()
      whereClause += ' AND pr.created_at >= ?'
      params.push(startDate)
    }

    // 排序
    const sortBy = query.sortBy === 'total_views' ? 'totalViews' : 'createdAt'
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC'

    // 查询总数 - 按 video_path + 10分钟时间窗口分组
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM (
        SELECT DISTINCT
          video_path || '||' || CAST(strftime('%s', created_at) / 600 AS TEXT) as groupKey
        FROM publish_records pr
        ${whereClause}
      )
    `)
    if (params.length) countStmt.bind(params as any[])
    countStmt.step()
    const total = (countStmt.getAsObject() as { cnt: number }).cnt
    countStmt.free()

    // 查询分组数据
    const groups: VideoGroupSummary[] = []

    const groupStmt = this.db.prepare(`
      SELECT
        pr.video_path || '||' || CAST(strftime('%s', pr.created_at) / 600 AS TEXT) as groupId,
        MIN(pr.title) as title,
        pr.video_path as videoPath,
        MIN(pr.cover_path) as coverPath,
        MIN(pr.created_at) as createdAt
      FROM publish_records pr
      ${whereClause}
      GROUP BY groupId
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `)
    const allParams = [...params, pageSize, offset]
    groupStmt.bind(allParams as any[])

    while (groupStmt.step()) {
      const obj = groupStmt.getAsObject() as {
        groupId: string
        title: string
        videoPath: string
        coverPath: string | null
        createdAt: string
      }

      // 获取该分组下所有平台的数据（同一视频 + 10分钟内）
      const platforms = this.getGroupPlatforms(obj.videoPath, obj.createdAt)
      const totalViews = platforms.reduce((sum, p) => sum + p.views, 0)
      const totalLikes = platforms.reduce((sum, p) => sum + p.likes, 0)
      const totalComments = platforms.reduce((sum, p) => sum + p.comments, 0)
      const totalShares = platforms.reduce((sum, p) => sum + p.shares, 0)

      groups.push({
        groupId: obj.groupId,
        title: obj.title,
        videoPath: obj.videoPath,
        coverPath: obj.coverPath || undefined,
        createdAt: obj.createdAt,
        platforms,
        totalViews,
        totalLikes,
        totalComments,
        totalShares
      })
    }
    groupStmt.free()

    // 如果按 totalViews 排序，在内存中排序
    if (query.sortBy === 'total_views') {
      groups.sort((a, b) => sortOrder === 'ASC' ? a.totalViews - b.totalViews : b.totalViews - a.totalViews)
    }

    return { groups, total, page, pageSize }
  }

  /** 获取分组下所有平台的数据摘要（同一视频 + 10分钟内，每个平台只取最新一条） */
  private getGroupPlatforms(videoPath: string, createdAt: string): VideoGroupPlatformSummary[] {
    const stmt = this.db.prepare(`
      SELECT
        pr.platform,
        pr.id as recordId,
        pr.content_id as contentId,
        pr.status,
        COALESCE(s.views, 0) as views,
        COALESCE(s.likes, 0) as likes,
        COALESCE(s.comments, 0) as comments,
        COALESCE(s.shares, 0) as shares,
        s.snapshot_at as lastSnapshotAt
      FROM publish_records pr
      LEFT JOIN (
        SELECT record_id, views, likes, comments, shares, snapshot_at,
               ROW_NUMBER() OVER (PARTITION BY record_id ORDER BY snapshot_at DESC) as rn
        FROM analytics_snapshots
      ) s ON s.record_id = pr.id AND s.rn = 1
      WHERE pr.video_path = ? AND pr.status = 'done'
        AND ABS(strftime('%s', pr.created_at) - strftime('%s', ?)) < 600
        AND pr.id = (
          SELECT id FROM publish_records
          WHERE video_path = pr.video_path AND platform = pr.platform AND status = 'done'
            AND ABS(strftime('%s', created_at) - strftime('%s', ?)) < 600
          ORDER BY created_at DESC
          LIMIT 1
        )
      ORDER BY pr.platform
    `)
    stmt.bind([videoPath, createdAt, createdAt])

    const rows: VideoGroupPlatformSummary[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as VideoGroupPlatformSummary)
    }
    stmt.free()
    return rows
  }

  /** 获取单个分组下各平台的数据摘要 */
  private getGroupPlatformSummary(groupId: string): VideoGroupPlatformSummary[] {
    const stmt = this.db.prepare(`
      SELECT
        pr.platform,
        pr.id as recordId,
        pr.content_id as contentId,
        pr.status,
        COALESCE(s.views, 0) as views,
        COALESCE(s.likes, 0) as likes,
        COALESCE(s.comments, 0) as comments,
        COALESCE(s.shares, 0) as shares,
        s.snapshot_at as lastSnapshotAt
      FROM publish_records pr
      LEFT JOIN (
        SELECT record_id, views, likes, comments, shares, snapshot_at,
               ROW_NUMBER() OVER (PARTITION BY record_id ORDER BY snapshot_at DESC) as rn
        FROM analytics_snapshots
      ) s ON s.record_id = pr.id AND s.rn = 1
      WHERE (pr.group_id = ? OR pr.id = ?) AND pr.status = 'done'
      ORDER BY pr.platform
    `)
    stmt.bind([groupId, groupId])

    const rows: VideoGroupPlatformSummary[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as VideoGroupPlatformSummary)
    }
    stmt.free()
    return rows
  }

  /** 获取视频分组详情 */
  getVideoGroupDetail(groupId: string): VideoGroupDetail | null {
    // Parse video_path and time bucket from groupId.
    // Format: video_path||timestamp/600  (separator is || — safe for paths with underscores)
    const sepIdx = groupId.lastIndexOf(GROUP_SEPARATOR)
    if (sepIdx <= 0) return null

    const videoPath = groupId.substring(0, sepIdx)
    const timeBucket = groupId.substring(sepIdx + GROUP_SEPARATOR.length)

    // 获取视频信息
    const prStmt = this.db.prepare(`
      SELECT MIN(title) as title, video_path as video_path, MIN(cover_path) as cover_path, MIN(created_at) as created_at
      FROM publish_records
      WHERE video_path = ? AND CAST(strftime('%s', created_at) / 600 AS TEXT) = ? AND status = 'done'
      GROUP BY video_path
    `)
    prStmt.bind([videoPath, timeBucket])

    let groupInfo: { title: string; video_path: string; cover_path: string | null; created_at: string } | null = null
    if (prStmt.step()) {
      groupInfo = prStmt.getAsObject() as any
    }
    prStmt.free()

    if (!groupInfo) return null

    // 获取该分组下所有记录的详情（同一视频 + 10分钟内）
    const recordsStmt = this.db.prepare(`
      SELECT
        pr.id as recordId,
        pr.platform,
        pr.account_id as accountId,
        pr.content_id as contentId,
        pr.title,
        pr.description,
        pr.status,
        pr.publish_url as publishUrl,
        pr.created_at as createdAt
      FROM publish_records pr
      WHERE pr.video_path = ? AND pr.status = 'done'
        AND CAST(strftime('%s', pr.created_at) / 600 AS TEXT) = ?
      ORDER BY pr.platform
    `)
    recordsStmt.bind([videoPath, timeBucket])

    const records: VideoGroupRecordDetail[] = []
    while (recordsStmt.step()) {
      const obj = recordsStmt.getAsObject() as {
        recordId: string
        platform: string
        accountId: string
        contentId: string | null
        title: string
        description: string
        status: string
        publishUrl: string | null
        createdAt: string
      }

      // 获取最新快照
      const latestSnapshot = this.getLatestSnapshot(obj.recordId)
      // 获取趋势数据（最近30天）
      const trend = this.getRecordTrend(obj.recordId, 30)

      records.push({
        recordId: obj.recordId,
        platform: obj.platform,
        accountId: obj.accountId,
        contentId: obj.contentId || undefined,
        title: obj.title,
        description: obj.description,
        status: obj.status,
        publishUrl: obj.publishUrl || undefined,
        createdAt: obj.createdAt,
        latestSnapshot: latestSnapshot || undefined,
        trend
      })
    }
    recordsStmt.free()

    return {
      groupId: groupInfo.id,
      title: groupInfo.title,
      videoPath: groupInfo.video_path,
      coverPath: groupInfo.cover_path || undefined,
      createdAt: groupInfo.created_at,
      records
    }
  }

  /** 获取单条记录的最新快照 */
  private getLatestSnapshot(recordId: string): VideoGroupRecordDetail['latestSnapshot'] {
    const stmt = this.db.prepare(`
      SELECT views, likes, comments, shares, followers, snapshot_at
      FROM analytics_snapshots
      WHERE record_id = ?
      ORDER BY snapshot_at DESC
      LIMIT 1
    `)
    stmt.bind([recordId])
    let result: VideoGroupRecordDetail['latestSnapshot'] = undefined
    if (stmt.step()) {
      const obj = stmt.getAsObject() as {
        views: number; likes: number; comments: number; shares: number; followers: number; snapshot_at: string
      }
      result = {
        views: obj.views,
        likes: obj.likes,
        comments: obj.comments,
        shares: obj.shares,
        followers: obj.followers,
        snapshotAt: obj.snapshot_at
      }
    }
    stmt.free()
    return result
  }

  /** 获取单条记录的趋势数据 */
  getRecordTrend(recordId: string, days: number = 30): TrendPoint[] {
    const startDate = new Date(Date.now() - days * 86400000).toISOString()
    const stmt = this.db.prepare(`
      SELECT views, likes, comments, shares, followers, snapshot_at
      FROM analytics_snapshots
      WHERE record_id = ? AND snapshot_at >= ?
      ORDER BY snapshot_at ASC
    `)
    stmt.bind([recordId, startDate])

    const rows: TrendPoint[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as TrendPoint)
    }
    stmt.free()
    return rows
  }
}
