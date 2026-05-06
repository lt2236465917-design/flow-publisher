import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAnalyticsRepository } from '../services/database'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import type { AnalyticsQuery } from '../../shared/contracts/analytics.contract'
import { logger } from '../utils/logger'

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

  logger.info('Analytics IPC handlers registered')
}
