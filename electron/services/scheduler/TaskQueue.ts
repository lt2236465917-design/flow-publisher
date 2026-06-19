import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../src/constants/ipc-channels'
import {
  getPublishRecordRepository,
  getAccountRepository,
  saveDatabase,
  saveDatabaseSync
} from '../database'
import { CookieStore } from '../browser/CookieStore'
import { getAdapter } from '../platform-adapters/PlatformAdapterRegistry'
import { HttpClient } from '../http/HttpClient'
import type { CookieContext } from '../http/HttpClient'
import { getPublishRiskGuard } from '../risk/PublishRiskGuard'
import { getSignService } from '../sign/SignService'
import type { IPlatformAdapter } from '../platform-adapters/IPlatformAdapter'
import { delay } from '../../utils/delays'
import { logger } from '../../utils/logger'
import type { ScheduledTaskRow } from '../database/repositories/scheduled-task.repo'
import type { ScheduledTaskRepository } from '../database/repositories/scheduled-task.repo'
import { getMainWindow } from '../../security/trusted-ipc'
import { decideScheduledPublishAction } from './scheduled-publish-policy'

async function ensureSessionHealthy(
  adapter: IPlatformAdapter,
  client: HttpClient,
  accountId: string,
  platformId: string
): Promise<void> {
  if (!adapter.checkSessionAPI) return

  const ok = await adapter.checkSessionAPI(client)
  if (ok) return

  const accountRepo = getAccountRepository()
  accountRepo.updateSession(accountId, 'expired', client.getCookieString())
  saveDatabase()
  throw new Error(`账号登录状态异常或已过期，请先重新登录 ${platformId}`)
}

async function ensureWebSignerReadyForScheduledTask(
  platformId: string,
  taskId: string,
  recordId: string,
  mainWindow: BrowserWindow | undefined
): Promise<void> {
  mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
    taskId,
    recordId,
    platformId,
    percent: 1,
    stage: '正在检查平台签名服务...'
  })

  const signService = getSignService()
  signService.clearFallbackCache()
  signService.setFallbackConfirmer(null)
  const result = await signService.ensureWebSignerReadyForPublish(platformId)
  if (!result.required) return

  logger.info(
    `[TaskQueue] Signer preflight passed for ${platformId}: mode=${result.mode}` +
    `${result.detail ? `, detail=${result.detail}` : ''}`
  )
}

export class TaskQueue {
  private _running = false
  private _currentTaskId: string | null = null
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

    logger.info(`[TaskQueue] Starting execution of task ${task.id}`)
    logger.info(`[TaskQueue] Task details - title: "${task.title}", platforms: ${task.platforms}, scheduled_at: ${task.scheduled_at}`)

    const results: { platform: string; success: boolean; error?: string }[] = []

    try {
      this.scheduledTaskRepo.updateStatus(task.id, 'running')
      saveDatabase()

      const platforms: string[] = JSON.parse(task.platforms)
      const accountIds: Record<string, string> = JSON.parse(task.account_ids)
      const platformOverrides: Record<string, Record<string, unknown>> = JSON.parse(task.platform_overrides || '{}')

      logger.info(`[TaskQueue] Platforms to publish: ${platforms.join(', ')}`)

      for (const platformId of platforms) {
        const accountId = accountIds[platformId]
        if (!accountId) {
          logger.error(`[TaskQueue] Platform ${platformId} has no account configured, skipping`)
          results.push({ platform: platformId, success: false, error: '未配置账号' })
          continue
        }

        const accountRepo = getAccountRepository()
        const account = accountRepo.getById(accountId)
        if (!account || account.session_status !== 'logged_in') {
          logger.error(`[TaskQueue] Platform ${platformId} account not logged in, skipping`)
          results.push({ platform: platformId, success: false, error: '账号未登录' })
          continue
        }

        logger.info(`[TaskQueue] Publishing to ${platformId} with account ${accountId}`)

        try {
          await this.publishToPlatform(
            task,
            platformId,
            accountId,
            platformOverrides[platformId] || {}
          )
          results.push({ platform: platformId, success: true })
          logger.info(`[TaskQueue] ✅ ${platformId} published successfully`)
        } catch (err) {
          logger.error(`[TaskQueue] ❌ ${platformId} failed:`, err)
          results.push({ platform: platformId, success: false, error: String(err) })
          // Continue with next platform instead of throwing
        }
      }

      // Determine final status based on results
      const successCount = results.filter(r => r.success).length
      const failCount = results.filter(r => !r.success).length
      const errorSummary = results
        .filter(r => !r.success)
        .map(r => `${r.platform}: ${r.error}`)
        .join('; ')

      if (successCount === platforms.length) {
        // All platforms succeeded
        this.scheduledTaskRepo.updateStatus(task.id, 'done')
        logger.info(`[TaskQueue] ✅ Task ${task.id} completed successfully - all ${successCount} platforms published`)
      } else if (successCount > 0) {
        // Partial success
        this.scheduledTaskRepo.updateStatus(task.id, 'partial', `部分成功: ${successCount}/${platforms.length} 平台发布成功. 失败: ${errorSummary}`)
        logger.warn(`[TaskQueue] ⚠️ Task ${task.id} partially completed - ${successCount}/${platforms.length} platforms published`)
      } else {
        // All platforms failed
        this.scheduledTaskRepo.updateStatus(task.id, 'error', `全部失败: ${errorSummary}`)
        logger.error(`[TaskQueue] ❌ Task ${task.id} failed - all platforms failed`)
      }

      saveDatabase()

      // Send summary to frontend
      const mainWindow = getMainWindow() || undefined
      mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
        taskId: task.id,
        percent: 100,
        stage: `发布完成: ${successCount}个成功, ${failCount}个失败`,
        results
      })

    } catch (err) {
      logger.error('[TaskQueue] Scheduled task failed:', task.id, err)
      this.scheduledTaskRepo.updateStatus(task.id, 'error', String(err))
      saveDatabase()
    } finally {
      this._running = false
      this._currentTaskId = null
      logger.info(`[TaskQueue] Task ${task.id} execution finished`)
    }
  }

  private async publishToPlatform(
    task: ScheduledTaskRow,
    platformId: string,
    accountId: string,
    platformFields: Record<string, unknown>
  ): Promise<void> {
    const adapter = getAdapter(platformId)
    if (!adapter) {
      throw new Error(`平台 ${platformId} 未找到适配器`)
    }

    if (!adapter.uploadVideoAPI || !adapter.submitContentAPI) {
      throw new Error(`平台 ${platformId} 不支持API模式`)
    }

    const recordRepo = getPublishRecordRepository()
    const record = recordRepo.createScheduled({
      sourceTaskId: task.id,
      accountId,
      platform: platformId,
      title: task.title,
      description: task.description,
      videoPath: task.video_path,
      coverPath: task.cover_path || undefined,
      hashtags: JSON.parse(task.hashtags || '[]'),
      declarations: JSON.parse(task.declarations || '[]')
    })
    if (record.account_id !== accountId) {
      throw new Error('定时任务账号与已有发布记录不匹配')
    }
    saveDatabaseSync()

    const action = decideScheduledPublishAction(record.status)
    if (action === 'skip') {
      if (record.status === 'unconfirmed') {
        throw new Error('上次提交结果未知，需要人工核对，未再次提交')
      }
      logger.info(
        `[TaskQueue] Reusing completed record ${record.id} for ${task.id}/${platformId}`
      )
      return
    }
    if (action === 'mark-unconfirmed') {
      const message = '上次提交在应用退出前未确认结果，已停止自动重试'
      recordRepo.updateStatus(record.id, 'unconfirmed', 99, message)
      saveDatabaseSync()
      throw new Error(message)
    }

    const mainWindow = getMainWindow() || undefined

    // Upload via API
    logger.info(`[TaskQueue] Uploading to ${platformId} via API`)

    const cookieStr = this.cookieStore.getCookieString(accountId)
    if (!cookieStr) {
      throw new Error('Cookie 不存在，请重新登录')
    }

    const context: CookieContext = {
      cookies: cookieStr,
      platform: platformId,
      accountId
    }
    const client = new HttpClient(context)

    const riskGuard = getPublishRiskGuard()
    let videoId = this.readPersistedVideoId(recordRepo.getUploadMeta(record.id))

    if (action === 'upload') {
      try {
        const result = await this.retryUpload(task, async () => {
          return await riskGuard.run(
            {
              accountId,
              platformId,
              stage: 'upload',
              recordId: record.id,
              onProgress: (progress) => {
                recordRepo.updateStatus(record.id, 'uploading', progress.percent)
                saveDatabase()
                mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
                  taskId: task.id,
                  recordId: record.id,
                  platformId,
                  ...progress
                })
              }
            },
            async () => {
              await ensureSessionHealthy(adapter, client, accountId, platformId)
              await ensureWebSignerReadyForScheduledTask(
                platformId,
                task.id,
                record.id,
                mainWindow
              )
              return await adapter.uploadVideoAPI!(
                client,
                task.video_path,
                (progress) => {
                  recordRepo.updateStatus(
                    record.id,
                    'uploading',
                    progress.percent
                  )
                  saveDatabase()
                  mainWindow?.webContents.send(
                    IPC_CHANNELS.SCHEDULE_PROGRESS,
                    {
                      taskId: task.id,
                      recordId: record.id,
                      platformId,
                      ...progress
                    }
                  )
                }
              )
            }
          )
        })

        videoId =
          typeof result === 'string'
            ? result
            : result &&
                typeof result === 'object' &&
                'videoId' in result
              ? String(result.videoId)
              : undefined
        if (!videoId) throw new Error('平台上传成功响应缺少 videoId')

        const resultMeta =
          result && typeof result === 'object' && 'meta' in result
            ? (result.meta as Record<string, unknown>)
            : {}
        recordRepo.saveUploadMeta(record.id, {
          ...resultMeta,
          _videoId: videoId
        })
        recordRepo.updateStatus(record.id, 'uploaded', 100)
        saveDatabaseSync()
      } catch (error) {
        recordRepo.updateStatus(record.id, 'error', undefined, String(error))
        saveDatabaseSync()
        throw error
      }
    }

    // Submit via API
    mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
      taskId: task.id,
      recordId: record.id,
      platformId,
      percent: 90,
      stage: '正在提交内容...'
    })

    // Merge shared declarations with platform-specific overrides
    const sharedDeclarations: string[] = JSON.parse(task.declarations || '[]')
    const platformDeclarations = platformFields.declarations
    const mergedDeclarations = Array.isArray(platformDeclarations) ? platformDeclarations as string[] : sharedDeclarations

    const content = {
      title: task.title,
      description: task.description,
      hashtags: JSON.parse(task.hashtags || '[]'),
      videoPath: task.video_path,
      coverPath: task.cover_path || undefined,
      declarations: mergedDeclarations,
      platformFields
    }

    logger.info(`[TaskQueue] Submitting to ${platformId} via API`)
    // Pass recordId so adapter can read upload metadata from DB (H7 + H11 fix)
    const contentWithRecord = { ...content, recordId: record.id }
    let submitStarted = false
    let submitResult
    try {
      await ensureSessionHealthy(adapter, client, accountId, platformId)
      await ensureWebSignerReadyForScheduledTask(
        platformId,
        task.id,
        record.id,
        mainWindow
      )
      submitResult = await riskGuard.run(
        {
          accountId,
          platformId,
          stage: 'submit',
          recordId: record.id,
          onProgress: (progress) => {
            mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
              taskId: task.id,
              recordId: record.id,
              platformId,
              ...progress
            })
          }
        },
        async () => {
          recordRepo.updateStatus(record.id, 'submitting', 90)
          saveDatabaseSync()
          submitStarted = true
          return await adapter.submitContentAPI!(
            client,
            contentWithRecord,
            videoId
          )
        }
      )

      if (platformId === 'xiaohongshu' && !submitResult?.contentId) {
        throw new Error('内容提交失败: 小红书未返回 note_id')
      }
    } catch (error) {
      if (submitStarted) {
        recordRepo.updateStatus(
          record.id,
          'unconfirmed',
          99,
          `提交结果无法确认，已停止自动重试: ${String(error)}`
        )
        saveDatabaseSync()
        throw new Error(`提交结果无法确认，已停止自动重试: ${String(error)}`)
      }
      throw error
    }

    const now = new Date().toISOString()
    if (submitResult?.contentId) recordRepo.updateContentId(record.id, submitResult.contentId)
    recordRepo.updateStatus(record.id, 'done', 100)
    recordRepo['db'].run(
      'UPDATE publish_records SET title = ?, description = ?, hashtags = ?, declarations = ?, updated_at = ? WHERE id = ?',
      [task.title, task.description, task.hashtags, task.declarations, now, record.id]
    )
    saveDatabaseSync()

    mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
      taskId: task.id,
      recordId: record.id,
      platformId,
      percent: 100,
      stage: '发布完成'
    })

    logger.info(`[TaskQueue] Successfully published to ${platformId} for task ${task.id}`)
  }

  private async retryUpload<T>(
    task: ScheduledTaskRow,
    operation: () => Promise<T>
  ): Promise<T> {
    const maxAttempts = Math.max(1, task.max_retries)
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (attempt >= maxAttempts) break
        this.scheduledTaskRepo.incrementRetry(task.id)
        saveDatabaseSync()
        await delay(1000 * Math.pow(2, attempt - 1))
      }
    }
    throw lastError
  }

  private readPersistedVideoId(
    uploadMeta: Record<string, unknown> | null
  ): string | undefined {
    const value = uploadMeta?._videoId
    return typeof value === 'string' && value ? value : undefined
  }
}
