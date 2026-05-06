import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getScheduledTaskRepository, saveDatabase } from '../services/database'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import { logger } from '../utils/logger'
import dayjs from 'dayjs'

export function registerSchedulerIpcHandlers(): void {
  // Create a scheduled task
  ipcMain.handle(IPC_CHANNELS.SCHEDULE_CREATE, async (_event, params: {
    platforms: string[]
    accountIds: Record<string, string>
    videoPath: string
    coverPath?: string
    title: string
    description: string
    hashtags?: string[]
    declarations?: string[]
    platformOverrides?: Record<string, Record<string, unknown>>
    scheduledAt: string
  }): Promise<IpcResponse> => {
    try {
      const scheduledTime = dayjs(params.scheduledAt)
      const minTime = dayjs().add(5, 'minute')
      if (!scheduledTime.isValid()) {
        return { success: false, error: '无效的定时时间' }
      }
      if (scheduledTime.isBefore(minTime)) {
        return { success: false, error: '定时时间必须在5分钟之后' }
      }

      const repo = getScheduledTaskRepository()
      const task = repo.create(params)
      saveDatabase()

      logger.info('Scheduled task created:', task.id, 'for', params.scheduledAt)
      return { success: true, data: task }
    } catch (err) {
      logger.error('SCHEDULE_CREATE error:', err)
      return { success: false, error: String(err) }
    }
  })

  // List all scheduled tasks
  ipcMain.handle(IPC_CHANNELS.SCHEDULE_LIST, async (): Promise<IpcResponse> => {
    try {
      const repo = getScheduledTaskRepository()
      const tasks = repo.getAll()
      return { success: true, data: tasks }
    } catch (err) {
      logger.error('SCHEDULE_LIST error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Cancel a pending scheduled task
  ipcMain.handle(IPC_CHANNELS.SCHEDULE_CANCEL, async (_event, taskId: string): Promise<IpcResponse> => {
    try {
      const repo = getScheduledTaskRepository()
      const task = repo.getById(taskId)
      if (!task) return { success: false, error: '任务不存在' }
      if (task.status !== 'pending') {
        return { success: false, error: '只能取消待执行的任务' }
      }

      repo.cancelTask(taskId)
      saveDatabase()
      logger.info('Scheduled task cancelled:', taskId)
      return { success: true }
    } catch (err) {
      logger.error('SCHEDULE_CANCEL error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Delete a scheduled task (only completed/failed/cancelled)
  ipcMain.handle(IPC_CHANNELS.SCHEDULE_DELETE, async (_event, taskId: string): Promise<IpcResponse> => {
    try {
      const repo = getScheduledTaskRepository()
      const task = repo.getById(taskId)
      if (!task) return { success: false, error: '任务不存在' }
      if (!['done', 'error', 'cancelled'].includes(task.status)) {
        return { success: false, error: '只能删除已完成、失败或已取消的任务' }
      }

      repo.deleteById(taskId)
      saveDatabase()
      logger.info('Scheduled task deleted:', taskId)
      return { success: true }
    } catch (err) {
      logger.error('SCHEDULE_DELETE error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('Scheduler IPC handlers registered')
}
