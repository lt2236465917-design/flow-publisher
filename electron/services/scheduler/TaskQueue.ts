import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../src/constants/ipc-channels'
import { getPublishRecordRepository, getAccountRepository, saveDatabase } from '../database'
import { BrowserManager } from '../browser/BrowserManager'
import { CookieStore } from '../browser/CookieStore'
import { getAdapter } from '../platform-adapters/PlatformAdapterRegistry'
import { retry, delay } from '../../utils/delays'
import { logger } from '../../utils/logger'
import type { ScheduledTaskRow } from '../database/repositories/scheduled-task.repo'
import type { ScheduledTaskRepository } from '../database/repositories/scheduled-task.repo'

export class TaskQueue {
  private _running = false
  private _currentTaskId: string | null = null
  private browserManager = new BrowserManager()
  private cookieStore = new CookieStore()

  constructor(private scheduledTaskRepo: ScheduledTaskRepository) {}

  get isRunning(): boolean {
    return this._running
  }

  get currentTaskId(): string | null {
    return this._currentTaskId
  }

  async execute(task: ScheduledTaskRow): Promise<void> {
    this._running = true
    this._currentTaskId = task.id

    try {
      this.scheduledTaskRepo.updateStatus(task.id, 'running')
      saveDatabase()

      const platforms: string[] = JSON.parse(task.platforms)
      const accountIds: Record<string, string> = JSON.parse(task.account_ids)
      const platformOverrides: Record<string, Record<string, unknown>> = JSON.parse(task.platform_overrides || '{}')

      for (const platformId of platforms) {
        const accountId = accountIds[platformId]
        if (!accountId) {
          throw new Error(`平台 ${platformId} 未配置账号`)
        }

        const accountRepo = getAccountRepository()
        const account = accountRepo.getById(accountId)
        if (!account || account.session_status !== 'logged_in') {
          throw new Error(`平台 ${platformId} 的账号未登录`)
        }

        await retry(
          () => this.publishToPlatform(task, platformId, accountId, platformOverrides[platformId] || {}),
          { maxAttempts: task.max_retries, delayMs: 1000, backoff: 2 }
        )
      }

      this.scheduledTaskRepo.updateStatus(task.id, 'done')
      saveDatabase()
      logger.info('Scheduled task completed:', task.id)
    } catch (err) {
      logger.error('Scheduled task failed:', task.id, err)
      this.scheduledTaskRepo.updateStatus(task.id, 'error', String(err))
      saveDatabase()
    } finally {
      this._running = false
      this._currentTaskId = null
    }
  }

  private async publishToPlatform(
    task: ScheduledTaskRow,
    platformId: string,
    accountId: string,
    platformFields: Record<string, unknown>
  ): Promise<void> {
    const adapter = getAdapter(platformId)
    if (!adapter?.uploadVideo || !adapter?.submitContent) {
      throw new Error(`平台 ${platformId} 暂不支持发布`)
    }

    const recordRepo = getPublishRecordRepository()
    const record = recordRepo.create({
      accountId,
      platform: platformId,
      title: task.title,
      description: task.description,
      videoPath: task.video_path,
      coverPath: task.cover_path || undefined,
      hashtags: JSON.parse(task.hashtags || '[]'),
      declarations: JSON.parse(task.declarations || '[]')
    })
    saveDatabase()

    const mainWindow = BrowserWindow.getAllWindows()[0]

    // Upload
    const context = await this.browserManager.getContext(platformId)
    await this.cookieStore.loadCookies(context, accountId)

    await adapter.uploadVideo(context, task.video_path, (progress) => {
      recordRepo.updateStatus(record.id, 'uploading', progress.percent)
      saveDatabase()
      mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
        taskId: task.id,
        recordId: record.id,
        platformId,
        ...progress
      })
    })

    recordRepo.updateStatus(record.id, 'uploaded', 100)
    saveDatabase()

    // Submit
    recordRepo.updateStatus(record.id, 'submitting', undefined)
    saveDatabase()

    mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
      taskId: task.id,
      recordId: record.id,
      platformId,
      percent: 90,
      stage: '正在提交内容...'
    })

    await adapter.submitContent(context, {
      title: task.title,
      description: task.description,
      hashtags: JSON.parse(task.hashtags || '[]'),
      coverPath: task.cover_path || undefined,
      declarations: JSON.parse(task.declarations || '[]'),
      platformFields
    })

    recordRepo.updateStatus(record.id, 'done', 100)
    // Update record with content via raw SQL (same pattern as publish.ipc.ts)
    const now = new Date().toISOString()
    recordRepo['db'].run(
      'UPDATE publish_records SET title = ?, description = ?, hashtags = ?, declarations = ?, updated_at = ? WHERE id = ?',
      [task.title, task.description, task.hashtags, task.declarations, now, record.id]
    )
    saveDatabase()

    mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
      taskId: task.id,
      recordId: record.id,
      platformId,
      percent: 100,
      stage: '发布完成'
    })

    await this.browserManager.close()
  }
}
