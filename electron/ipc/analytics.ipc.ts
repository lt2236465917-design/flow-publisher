import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAnalyticsRepository } from '../services/database'
import { AnalyticsCollectorService } from '../services/analytics/AnalyticsCollectorService'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import type { AnalyticsQuery, VideoGroupQuery } from '../../shared/contracts/analytics.contract'
import { logger } from '../utils/logger'

let collectorService: AnalyticsCollectorService | null = null

function getCollector(): AnalyticsCollectorService {
  if (!collectorService) {
    collectorService = new AnalyticsCollectorService()
  }
  return collectorService
}

export function registerAnalyticsIpcHandlers(): void {
  // Fetch analytics overview data
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_FETCH, async (_event, query: AnalyticsQuery): Promise<IpcResponse> => {
    try {
      const repo = getAnalyticsRepository()
      const overview = repo.getOverview(query)
      return { success: true, data: overview }
    } catch (err) {
      logger.error('ANALYTICS_FETCH error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Compare platforms
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_COMPARE, async (_event, query: AnalyticsQuery): Promise<IpcResponse> => {
    try {
      const repo = getAnalyticsRepository()
      const result = repo.comparePlatforms(query)
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_COMPARE error:', err)
      return { success: false, error: String(err) }
    }
  })

  // ---- 数据采集 ----

  // 采集单个账号的数据
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_COLLECT, async (_event, { accountId }: { accountId: string }): Promise<IpcResponse> => {
    try {
      const collector = getCollector()
      const result = await collector.collectAccountData(accountId)
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_COLLECT error:', err)
      return { success: false, error: String(err) }
    }
  })

  // 采集所有已登录账号的数据
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_COLLECT_ALL, async (): Promise<IpcResponse> => {
    try {
      const collector = getCollector()
      const result = await collector.collectAllAccounts()
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_COLLECT_ALL error:', err)
      return { success: false, error: String(err) }
    }
  })

  // 采集指定视频分组的数据
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_COLLECT_GROUP, async (_event, { groupId }: { groupId: string }): Promise<IpcResponse> => {
    try {
      const collector = getCollector()
      const repo = getAnalyticsRepository()
      // 获取该分组下的所有记录
      const detail = repo.getVideoGroupDetail(groupId)
      if (!detail) {
        return { success: false, error: '视频分组不存在' }
      }
      // 采集每条记录的数据
      const results = []
      for (const record of detail.records) {
        const result = await collector.collectRecordData(record.recordId)
        results.push(result)
      }
      // 合并结果
      const merged = {
        totalRecords: results.reduce((sum, r) => sum + r.totalRecords, 0),
        updatedRecords: results.reduce((sum, r) => sum + r.updatedRecords, 0),
        newSnapshots: results.reduce((sum, r) => sum + r.newSnapshots, 0),
        errors: results.flatMap(r => r.errors)
      }
      return { success: true, data: merged }
    } catch (err) {
      logger.error('ANALYTICS_COLLECT_GROUP error:', err)
      return { success: false, error: String(err) }
    }
  })

  // ---- 视频分组查询 ----

  // 获取视频分组列表
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_VIDEO_GROUPS, async (_event, query: VideoGroupQuery): Promise<IpcResponse> => {
    try {
      const repo = getAnalyticsRepository()
      const result = repo.getVideoGroups(query)
      logger.info(`[Analytics] VIDEO_GROUPS: query=${JSON.stringify(query)}, groups=${result.groups.length}, total=${result.total}`)
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_VIDEO_GROUPS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // 获取视频分组详情
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_VIDEO_DETAIL, async (_event, { groupId }: { groupId: string }): Promise<IpcResponse> => {
    try {
      const repo = getAnalyticsRepository()
      const result = repo.getVideoGroupDetail(groupId)
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_VIDEO_DETAIL error:', err)
      return { success: false, error: String(err) }
    }
  })

  // 获取单条记录的趋势数据
  ipcMain.handle(IPC_CHANNELS.ANALYTICS_RECORD_TREND, async (_event, { recordId, days }: { recordId: string; days?: number }): Promise<IpcResponse> => {
    try {
      const repo = getAnalyticsRepository()
      const result = repo.getRecordTrend(recordId, days || 30)
      return { success: true, data: result }
    } catch (err) {
      logger.error('ANALYTICS_RECORD_TREND error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('Analytics IPC handlers registered')
}
