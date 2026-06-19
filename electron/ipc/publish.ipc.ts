import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAccountRepository, getPublishRecordRepository, saveDatabase } from '../services/database'
import { CookieStore } from '../services/browser/CookieStore'
import { getAdapter } from '../services/platform-adapters/PlatformAdapterRegistry'
import { getSignService } from '../services/sign/SignService'
import { shouldAutoConfirmBuiltinSigner } from '../services/sign/SignPolicy'
import { HttpClient } from '../services/http/HttpClient'
import type { CookieContext } from '../services/http/HttpClient'
import { ffmpegService } from '../services/ffmpeg/FFmpegService'
import { validateVideo } from '../services/ffmpeg/VideoValidator'
import { ipLocationService } from '../services/location/IPLocationService'
import { getPublishRiskGuard } from '../services/risk/PublishRiskGuard'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import type { IPlatformAdapter, VideoMetadata } from '../services/platform-adapters/IPlatformAdapter'
import { logger } from '../utils/logger'
import {
  getMainWindow,
  registerTrustedIpcHandler
} from '../security/trusted-ipc'
import { requireAllowedFile } from '../security/file-access-policy'
import {
  getSubmitFailureUpdate,
  resolveSubmittedVideoId,
  validateSubmitRelationship,
  validateUploadRelationship
} from '../services/publish/publish-validation'
import { summarizePayload } from '../utils/log-redaction'

const cookieStore = new CookieStore()
const SIGN_FALLBACK_CONFIRM_TIMEOUT_MS = 180_000

// Pending sign-fallback confirmation — resolve function is set when the main process
// waits for the renderer to confirm whether to use local Playwright-based signing.
let pendingSignConfirm: ((confirmed: boolean) => void) | null = null
let pendingSignConfirmPromise: Promise<boolean> | null = null
let pendingSignConfirmTimer: ReturnType<typeof setTimeout> | null = null
let activeSignFallbackRunId: string | null = null

function resolvePendingSignConfirm(confirmed: boolean): void {
  const resolve = pendingSignConfirm
  if (!resolve) return

  if (pendingSignConfirmTimer) {
    clearTimeout(pendingSignConfirmTimer)
    pendingSignConfirmTimer = null
  }
  pendingSignConfirm = null
  pendingSignConfirmPromise = null
  resolve(confirmed)
}

function requestSignFallbackConfirmation(mainWindow: BrowserWindow | undefined, platform: string): Promise<boolean> {
  if (shouldAutoConfirmBuiltinSigner()) {
    logger.warn(`[publish] Auto-confirming built-in local signer fallback for ${platform}`)
    return Promise.resolve(true)
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(false)
  }
  if (pendingSignConfirmPromise) {
    return pendingSignConfirmPromise
  }

  pendingSignConfirmPromise = new Promise((resolve) => {
    pendingSignConfirm = resolve
    mainWindow.webContents.send(IPC_CHANNELS.PUBLISH_SIGN_FALLBACK_WARNING, { platform })
    // Safety timeout: auto-deny if user doesn't respond.
    pendingSignConfirmTimer = setTimeout(() => {
      resolvePendingSignConfirm(false)
    }, SIGN_FALLBACK_CONFIRM_TIMEOUT_MS)
  })

  return pendingSignConfirmPromise
}

function configureSignFallback(mainWindow: BrowserWindow | undefined, publishRunId?: string): void {
  const signService = getSignService()
  const runId = publishRunId || `ipc-${Date.now()}-${Math.random().toString(36).slice(2)}`

  if (activeSignFallbackRunId !== runId) {
    resolvePendingSignConfirm(false)
    activeSignFallbackRunId = runId
    signService.clearFallbackCache()
  }

  signService.setFallbackConfirmer((platform: string) => requestSignFallbackConfirmation(mainWindow, platform))
}

async function ensureSessionHealthy(
  adapter: IPlatformAdapter,
  client: HttpClient,
  accountId: string,
  platformId: string
): Promise<void> {
  if (!adapter.checkSessionAPI) return

  const ok = await adapter.checkSessionAPI(client)
  if (ok) return

  try {
    const accountRepo = getAccountRepository()
    accountRepo.updateSession(accountId, 'expired', client.getCookieString())
    saveDatabase()
  } catch (err) {
    logger.warn(`[publish] Failed to mark ${platformId} account as expired after session preflight:`, err)
  }

  throw new Error('账号登录状态异常或已过期，请先重新登录后再发布')
}

async function ensureWebSignerReadyForUpload(
  platformId: string,
  recordId: string,
  mainWindow: BrowserWindow | undefined
): Promise<void> {
  if (platformId === 'xiaohongshu') {
    logger.info('[publish] Skipping xiaohongshu signer preflight during upload; note create signature will be verified before submit')
    return
  }

  mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
    recordId,
    percent: 1,
    stage: '正在检查平台签名服务...'
  })

  const result = await getSignService().ensureWebSignerReadyForPublish(platformId)
  if (!result.required) return

  logger.info(
    `[publish] Signer preflight passed for ${platformId}: mode=${result.mode}` +
    `${result.detail ? `, detail=${result.detail}` : ''}`
  )
}

export function registerPublishIpcHandlers(): void {
  // Sign-fallback confirmation — renderer responds when user dismisses the warning dialog
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_CONFIRM_SIGN_FALLBACK, (_event, confirmed: boolean) => {
    logger.info(`[publish] Sign fallback confirmation: ${confirmed ? 'accepted' : 'denied'}`)
    resolvePendingSignConfirm(confirmed)
    return { success: true }
  })

  // Probe video metadata
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_PROBE_VIDEO, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      const probe = await ffmpegService.probeVideo(requireAllowedFile(filePath))
      return { success: true, data: probe }
    } catch (err) {
      logger.error('PUBLISH_PROBE_VIDEO error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Extract cover frames
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_EXTRACT_FRAMES, async (_event, filePath: string, count?: number): Promise<IpcResponse> => {
    try {
      const frames = await ffmpegService.extractFrames(
        requireAllowedFile(filePath),
        count || 8
      )
      return { success: true, data: frames }
    } catch (err) {
      logger.error('PUBLISH_EXTRACT_FRAMES error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Validate video for platform
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_VALIDATE_VIDEO, async (_event, filePath: string, platformId: string): Promise<IpcResponse> => {
    try {
      const probe = await ffmpegService.probeVideo(requireAllowedFile(filePath))
      const result = validateVideo(probe, platformId)
      return { success: true, data: result }
    } catch (err) {
      logger.error('PUBLISH_VALIDATE_VIDEO error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Upload video to platform (API mode)
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_UPLOAD, async (_event, params: {
    accountId: string
    platformId: string
    filePath: string
    publishRunId?: string
    hasCustomCover?: boolean
  }): Promise<IpcResponse> => {
    let createdRecordId: string | null = null
    try {
      const videoPath = requireAllowedFile(params.filePath)
      const adapter = getAdapter(params.platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${params.platformId}` }
      }

      if (!adapter.uploadVideoAPI) {
        return { success: false, error: `平台 ${params.platformId} 不支持API上传` }
      }

      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(params.accountId)
      if (!account) return { success: false, error: '账号不存在' }
      validateUploadRelationship(account, params.platformId)

      // Create publish record
      const recordRepo = getPublishRecordRepository()
      const record = recordRepo.create({
        accountId: params.accountId,
        platform: params.platformId,
        title: '',
        description: '',
        videoPath
      })
      createdRecordId = record.id
      saveDatabase()

      const mainWindow = getMainWindow() || undefined

      logger.info(`[publish] Uploading to ${params.platformId} via API`)

      const cookieStr = cookieStore.getCookieString(params.accountId)
      if (!cookieStr) {
        return { success: false, error: 'Cookie 不存在，请重新登录' }
      }

      const context: CookieContext = {
        cookies: cookieStr,
        platform: params.platformId,
        accountId: params.accountId
      }
      const client = new HttpClient(context)

      configureSignFallback(mainWindow, params.publishRunId)

      const riskGuard = getPublishRiskGuard()
      const result = await riskGuard.run(
        {
          accountId: params.accountId,
          platformId: params.platformId,
          stage: 'upload',
          recordId: record.id,
          onProgress: (progress) => {
            recordRepo.updateStatus(record.id, 'uploading', progress.percent)
            saveDatabase()
            mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
              recordId: record.id,
              platformId: params.platformId,
              ...progress
            })
          }
        },
        async () => {
          await ensureSessionHealthy(adapter, client, params.accountId, params.platformId)
          await ensureWebSignerReadyForUpload(params.platformId, record.id, mainWindow)
          return await adapter.uploadVideoAPI!(
            client,
            videoPath,
            (progress) => {
              recordRepo.updateStatus(record.id, 'uploading', progress.percent)
              saveDatabase()
              mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
                recordId: record.id,
                platformId: params.platformId,
                ...progress
              })
            },
            { waitForServerCover: !(params.platformId === 'xiaohongshu' && params.hasCustomCover) }
          )
        }
      )
      // Handle both legacy string return and new UploadResult (H7 + H11 fix)
      const videoId = typeof result === 'string' ? result
        : (result && typeof result === 'object' && 'videoId' in result) ? (result as { videoId: string; meta: Record<string, unknown> }).videoId
        : undefined
      if (!videoId) throw new Error('平台上传成功响应缺少 videoId')
      // Persist upload metadata so submit can recover from crashes
      const uploadMeta =
        result && typeof result === 'object' && 'meta' in result
          ? (result as { meta: Record<string, unknown> }).meta
          : {}
      recordRepo.saveUploadMeta(record.id, {
        ...uploadMeta,
        _videoId: videoId
      })

      recordRepo.updateStatus(record.id, 'uploaded', 100)
      saveDatabase()

      return { success: true, data: { recordId: record.id, videoId } }
    } catch (err) {
      logger.error('PUBLISH_UPLOAD error:', err)
      // Mark the publish record as 'error' so it doesn't remain orphaned as 'pending'
      try {
        const recordRepo = getPublishRecordRepository()
        if (createdRecordId) {
          recordRepo.updateStatus(createdRecordId, 'error', undefined, String(err))
        }
        saveDatabase()
      } catch (cleanupErr) {
        logger.warn('Failed to mark orphaned record as error:', cleanupErr)
      }
      return { success: false, error: String(err) }
    }
  })

  // Submit content (API mode)
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_SUBMIT, async (_event, params: {
    recordId: string
    platformId: string
    videoId?: string
    publishRunId?: string
    content: {
      title: string
      description: string
      hashtags: string[]
      mentions?: string[]
      location?: { name: string; lat: number; lng: number; poi_id: string } | null
      collection?: string | null
      visibility?: 'public' | 'friends' | 'private'
      publishTime?: { mode: 'now' | 'scheduled'; scheduled_at: string | null }
      originalDeclaration?: boolean
      cover?: { horizontal_4_3: string | null; vertical_3_4: string | null; recommended: string[] }
      coverPath?: string
      declarations: string[]
      platformFields?: Record<string, unknown>
    }
  }): Promise<IpcResponse> => {
    let submitStarted = false
    let validatedRecordId: string | null = null
    try {
      logger.info(
        `[publish] Submit payload summary: ${JSON.stringify(
          summarizePayload(params.content)
        )}`
      )

      // Guard: IPC may serialize undefined as the string "undefined"
      if (params.content.coverPath === 'undefined') {
        params.content.coverPath = undefined
      }
      if (params.content.coverPath) {
        params.content.coverPath = requireAllowedFile(params.content.coverPath)
      }

      const adapter = getAdapter(params.platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${params.platformId}` }
      }

      if (!adapter.submitContentAPI) {
        return { success: false, error: `平台 ${params.platformId} 不支持API提交` }
      }

      const recordRepo = getPublishRecordRepository()
      const record = recordRepo.getById(params.recordId)
      if (!record) return { success: false, error: '发布记录不存在' }
      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(record.account_id)
      if (!account) return { success: false, error: '发布记录账号不存在' }
      validateSubmitRelationship(record, account, params.platformId)
      validatedRecordId = record.id
      const uploadMeta = recordRepo.getUploadMeta(record.id)
      const persistedVideoId =
        typeof uploadMeta?._videoId === 'string'
          ? uploadMeta._videoId
          : undefined
      const effectiveVideoId = resolveSubmittedVideoId(
        persistedVideoId,
        params.videoId
      )

      const mainWindow = getMainWindow() || undefined

      logger.info(`[publish] Submitting to ${params.platformId} via API`)

      mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
        recordId: params.recordId,
        percent: 90,
        stage: '正在提交内容...'
      })

      const cookieStr = cookieStore.getCookieString(record.account_id)
      if (!cookieStr) {
        return { success: false, error: 'Cookie 不存在，请重新登录' }
      }

      const context: CookieContext = {
        cookies: cookieStr,
        platform: params.platformId,
        accountId: record.account_id
      }
      const client = new HttpClient(context)

      configureSignFallback(mainWindow, params.publishRunId)

      // Probe video metadata to pass actual values (width, height, duration, fps)
      let videoMetadata: VideoMetadata | undefined
      try {
        const probe = await ffmpegService.probeVideo(record.video_path)
        videoMetadata = {
          width: probe.width,
          height: probe.height,
          duration: Math.round(probe.duration),
          fps: probe.fps,
          bitrate: probe.bitrate,
          format: probe.format
        }
        logger.info(
          `[publish] Video metadata: ${JSON.stringify(
            summarizePayload(videoMetadata)
          )}`
        )
      } catch (e) {
        logger.warn(`[publish] Failed to probe video metadata: ${e}`)
      }

      const riskGuard = getPublishRiskGuard()
      const submitResult = await riskGuard.run(
        {
          accountId: record.account_id,
          platformId: params.platformId,
          stage: 'submit',
          recordId: params.recordId,
          onProgress: (progress) => {
            recordRepo.updateStatus(params.recordId, 'submitting', progress.percent)
            saveDatabase()
            mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
              recordId: params.recordId,
              ...progress
            })
          }
        },
        async () => {
          // Upload cover image if provided (for platforms that support it, e.g. XHS)
          let coverFileId: string | undefined
          if (params.content.coverPath && adapter.uploadCoverImageAPI) {
            try {
              mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
                recordId: params.recordId,
                percent: 85,
                stage: '正在上传封面...'
              })
              coverFileId = await adapter.uploadCoverImageAPI(client, params.content.coverPath)
              logger.info('[publish] Cover uploaded')
            } catch (e) {
              logger.warn(`[publish] Cover upload failed (non-fatal): ${e}`)
              // Non-fatal: continue without cover
            }
          }

          // Merge video metadata into content payload
          const contentWithMeta = { ...params.content, videoMetadata, videoPath: record.video_path }
          // Pass recordId so adapter can read upload metadata from DB (H7 + H11 fix)
          const contentWithRecord = { ...contentWithMeta, recordId: params.recordId }
          recordRepo.updateStatus(params.recordId, 'submitting', 90)
          saveDatabase()
          submitStarted = true
          return await adapter.submitContentAPI!(
            client,
            contentWithRecord,
            effectiveVideoId,
            coverFileId
          )
        }
      )

      if (params.platformId === 'xiaohongshu' && !submitResult?.contentId) {
        throw new Error('内容提交失败: 小红书未返回 note_id，已停止标记为发布成功。请保留日志并重试 API 发布。')
      }

      const now = new Date().toISOString()

      if (submitResult?.contentId) {
        recordRepo.updateContentId(params.recordId, submitResult.contentId)
        logger.info(`[publish] Saved content ID for record: ${params.recordId}`)
      }

      recordRepo.updateStatus(params.recordId, 'done', 100)

      // 保存 contentId 和 publishUrl（如果有的话）
      if (submitResult?.publishUrl) {
        recordRepo.updateStatus(params.recordId, 'done', 100, undefined, submitResult.publishUrl)
      }

      // 更新标题、描述、封面等字段
      recordRepo['db'].run(
        'UPDATE publish_records SET title = ?, description = ?, hashtags = ?, declarations = ?, cover_path = ?, updated_at = ? WHERE id = ?',
        [params.content.title, params.content.description, JSON.stringify(params.content.hashtags), JSON.stringify(params.content.declarations), params.content.coverPath || null, now, params.recordId]
      )
      saveDatabase()

      mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
        recordId: params.recordId,
        percent: 100,
        stage: '发布完成'
      })

      return { success: true, data: { recordId: params.recordId } }
    } catch (err) {
      logger.error('PUBLISH_SUBMIT error:', err)
      const failure = getSubmitFailureUpdate(
        validatedRecordId,
        submitStarted,
        err
      )
      if (failure) {
        const recordRepo = getPublishRecordRepository()
        recordRepo.updateStatus(
          failure.recordId,
          failure.status,
          undefined,
          failure.message
        )
        saveDatabase()
      }
      return { success: false, error: failure?.message || String(err) }
    }
  })

  // Get platform-specific field definitions
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_GET_PLATFORM_FIELDS, async (_event, platformId: string): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(platformId)
      const fields = adapter?.getPlatformFields?.() ?? []
      return { success: true, data: fields }
    } catch (err) {
      logger.error('PUBLISH_GET_PLATFORM_FIELDS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get IP location
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_GET_IP_LOCATION, async (): Promise<IpcResponse> => {
    try {
      const location = await ipLocationService.getLocation()
      return { success: true, data: location }
    } catch (err) {
      logger.error('PUBLISH_GET_IP_LOCATION error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get recommend locations for a platform
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_GET_RECOMMEND_LOCATIONS, async (_event, params: {
    platformId: string
    accountId: string
    lat?: number
    lng?: number
  }): Promise<IpcResponse> => {
    try {
      logger.info(
        `[publish] PUBLISH_GET_RECOMMEND_LOCATIONS called: ${JSON.stringify(
          summarizePayload(params)
        )}`
      )

      const adapter = getAdapter(params.platformId)
      if (!adapter?.getRecommendLocations) {
        logger.info(`[publish] Platform ${params.platformId} does not support getRecommendLocations`)
        return { success: true, data: [] }
      }

      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(params.accountId)
      if (!account) {
        logger.warn(`[publish] Account not found: ${params.accountId}`)
        return { success: false, error: '账号不存在' }
      }
      if (account.session_status !== 'logged_in') {
        logger.warn(`[publish] Account not logged in: ${params.accountId}, status: ${account.session_status}`)
        return { success: false, error: '账号未登录，请先登录' }
      }

      const cookieStr = cookieStore.getCookieString(params.accountId)
      if (!cookieStr) {
        logger.warn(`[publish] Cookie not found for account: ${params.accountId}`)
        return { success: false, error: 'Cookie 不存在，请重新登录' }
      }

      logger.info(`[publish] Fetching recommend locations for ${params.platformId}`)

      // Get IP location to provide city name for city-level results
      let cityName = ''
      try {
        const ipLoc = await ipLocationService.getLocation()
        cityName = ipLoc.city || ''
      } catch { /* ignore */ }

      const context: CookieContext = {
        cookies: cookieStr,
        platform: params.platformId,
        accountId: params.accountId
      }
      const client = new HttpClient(context)
      const results = await adapter.getRecommendLocations(client, {
        lat: params.lat,
        lng: params.lng,
        count: 20,
        city: cityName
      })

      logger.info(`[publish] Got ${results.length} recommend locations for ${params.platformId}`)

      return { success: true, data: results }
    } catch (err) {
      logger.error('PUBLISH_GET_RECOMMEND_LOCATIONS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Search POI locations for a platform
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_SEARCH_LOCATION, async (_event, params: {
    platformId: string
    accountId: string
    keyword: string
    lat?: number
    lng?: number
  }): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(params.platformId)
      if (!adapter?.searchLocation) {
        return { success: false, error: `平台 ${params.platformId} 不支持位置搜索` }
      }

      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(params.accountId)
      if (!account) return { success: false, error: '账号不存在' }
      if (account.session_status !== 'logged_in') {
        return { success: false, error: '账号未登录，请先登录' }
      }

      const cookieStr = cookieStore.getCookieString(params.accountId)
      if (!cookieStr) {
        return { success: false, error: 'Cookie 不存在，请重新登录' }
      }

      const context: CookieContext = {
        cookies: cookieStr,
        platform: params.platformId,
        accountId: params.accountId
      }
      const client = new HttpClient(context)
      const results = await adapter.searchLocation(client, params.keyword, {
        lat: params.lat,
        lng: params.lng,
        count: 20
      })
      return { success: true, data: results }
    } catch (err) {
      logger.error('PUBLISH_SEARCH_LOCATION error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get collections for a platform (e.g. Douyin)
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_GET_COLLECTIONS, async (_event, params: {
    platformId: string
    accountId: string
  }): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(params.platformId)
      if (!adapter?.getCollections) {
        return { success: true, data: [] }
      }

      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(params.accountId)
      if (!account) return { success: false, error: '账号不存在' }
      if (account.session_status !== 'logged_in') {
        return { success: false, error: '账号未登录，请先登录' }
      }

      const cookieStr = cookieStore.getCookieString(params.accountId)
      if (!cookieStr) {
        return { success: false, error: 'Cookie 不存在，请重新登录' }
      }

      const context: CookieContext = {
        cookies: cookieStr,
        platform: params.platformId,
        accountId: params.accountId
      }
      const client = new HttpClient(context)
      const collections = await adapter.getCollections(client)
      return { success: true, data: collections }
    } catch (err) {
      logger.error('PUBLISH_GET_COLLECTIONS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // List publish records
  registerTrustedIpcHandler(IPC_CHANNELS.PUBLISH_LIST_RECORDS, async (): Promise<IpcResponse> => {
    try {
      const recordRepo = getPublishRecordRepository()
      const records = recordRepo.getAll()
      return { success: true, data: records }
    } catch (err) {
      logger.error('PUBLISH_LIST_RECORDS error:', err)
      return { success: false, error: String(err) }
    }
  })

  logger.info('Publish IPC handlers registered (API mode)')
}
