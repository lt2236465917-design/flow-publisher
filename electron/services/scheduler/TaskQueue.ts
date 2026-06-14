import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../src/constants/ipc-channels'
import { getPublishRecordRepository, getAccountRepository, saveDatabase } from '../database'
import { CookieStore } from '../browser/CookieStore'
import { getAdapter } from '../platform-adapters/PlatformAdapterRegistry'
import { HttpClient } from '../http/HttpClient'
import type { CookieContext } from '../http/HttpClient'
import { getPublishRiskGuard } from '../risk/PublishRiskGuard'
import { getSignService } from '../sign/SignService'
import type { IPlatformAdapter } from '../platform-adapters/IPlatformAdapter'
import { retry, delay } from '../../utils/delays'
import { logger } from '../../utils/logger'
import type { ScheduledTaskRow } from '../database/repositories/scheduled-task.repo'
import type { ScheduledTaskRepository } from '../database/repositories/scheduled-task.repo'

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
          await retry(
            () => this.publishToPlatform(task, platformId, accountId, platformOverrides[platformId] || {}),
            { maxAttempts: task.max_retries, delayMs: 1000, backoff: 2 }
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
      const mainWindow = BrowserWindow.getAllWindows()[0]
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
    const result = await riskGuard.run(
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
        await ensureWebSignerReadyForScheduledTask(platformId, task.id, record.id, mainWindow)
        return await adapter.uploadVideoAPI!(client, task.video_path, (progress) => {
          recordRepo.updateStatus(record.id, 'uploading', progress.percent)
          saveDatabase()
          mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
            taskId: task.id,
            recordId: record.id,
            platformId,
            ...progress
          })
        })
      }
    )
    // Handle both legacy string return and new UploadResult (H7 + H11 fix)
    const videoId = typeof result === 'string' ? result
      : (result && typeof result === 'object' && 'videoId' in result) ? (result as { videoId: string; meta: Record<string, unknown> }).videoId
      : undefined
    if (result && typeof result === 'object' && 'meta' in result) {
      recordRepo.saveUploadMeta(record.id, (result as { meta: Record<string, unknown> }).meta)
    }

    recordRepo.updateStatus(record.id, 'uploaded', 100)
    saveDatabase()

    // Submit via API
    recordRepo.updateStatus(record.id, 'submitting', undefined)
    saveDatabase()

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
    const submitResult = await riskGuard.run(
      {
        accountId,
        platformId,
        stage: 'submit',
        recordId: record.id,
        onProgress: (progress) => {
          recordRepo.updateStatus(record.id, 'submitting', progress.percent)
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
        return await adapter.submitContentAPI!(client, contentWithRecord, videoId)
      }
    )

    const now = new Date().toISOString()
    if (platformId === 'xiaohongshu' && submitResult?.confirmed === false) {
      const message = '小红书已受理提交请求，但未返回 note_id；请到创作者中心的发布管理、审核中或草稿箱确认。'
      if (submitResult.contentId) recordRepo.updateContentId(record.id, submitResult.contentId)
      recordRepo.updateStatus(record.id, 'unconfirmed', 99, message)
      recordRepo['db'].run(
        'UPDATE publish_records SET title = ?, description = ?, hashtags = ?, declarations = ?, updated_at = ? WHERE id = ?',
        [task.title, task.description, task.hashtags, task.declarations, now, record.id]
      )
      saveDatabase()

      mainWindow?.webContents.send(IPC_CHANNELS.SCHEDULE_PROGRESS, {
        taskId: task.id,
        recordId: record.id,
        platformId,
        percent: 99,
        stage: '小红书已受理，等待平台确认'
      })

      logger.info(`[TaskQueue] Xiaohongshu submit unconfirmed for task ${task.id}`)
      return
    }

    recordRepo.updateStatus(record.id, 'done', 100)
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

    logger.info(`[TaskQueue] Successfully published to ${platformId} for task ${task.id}`)
  }
}
