import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../src/constants/ipc-channels'
import { getAccountRepository, getPublishRecordRepository, saveDatabase } from '../services/database'
import { BrowserManager } from '../services/browser/BrowserManager'
import { CookieStore } from '../services/browser/CookieStore'
import { getAdapter, getEffectiveMode, getPublishMode, setPublishMode } from '../services/platform-adapters/PlatformAdapterRegistry'
import { HttpClient } from '../services/http/HttpClient'
import type { CookieContext } from '../services/http/HttpClient'
import { ffmpegService } from '../services/ffmpeg/FFmpegService'
import { validateVideo } from '../services/ffmpeg/VideoValidator'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'
import { logger } from '../utils/logger'

const browserManager = new BrowserManager()
const cookieStore = new CookieStore()

export function registerPublishIpcHandlers(): void {
  // Probe video metadata
  ipcMain.handle(IPC_CHANNELS.PUBLISH_PROBE_VIDEO, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      const probe = await ffmpegService.probeVideo(filePath)
      return { success: true, data: probe }
    } catch (err) {
      logger.error('PUBLISH_PROBE_VIDEO error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Extract cover frames
  ipcMain.handle(IPC_CHANNELS.PUBLISH_EXTRACT_FRAMES, async (_event, filePath: string, count?: number): Promise<IpcResponse> => {
    try {
      const frames = await ffmpegService.extractFrames(filePath, count || 8)
      return { success: true, data: frames }
    } catch (err) {
      logger.error('PUBLISH_EXTRACT_FRAMES error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Validate video for platform
  ipcMain.handle(IPC_CHANNELS.PUBLISH_VALIDATE_VIDEO, async (_event, filePath: string, platformId: string): Promise<IpcResponse> => {
    try {
      const probe = await ffmpegService.probeVideo(filePath)
      const result = validateVideo(probe, platformId)
      return { success: true, data: result }
    } catch (err) {
      logger.error('PUBLISH_VALIDATE_VIDEO error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Upload video to platform
  ipcMain.handle(IPC_CHANNELS.PUBLISH_UPLOAD, async (_event, params: {
    accountId: string
    platformId: string
    filePath: string
  }): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(params.platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${params.platformId}` }
      }

      const accountRepo = getAccountRepository()
      const account = accountRepo.getById(params.accountId)
      if (!account) return { success: false, error: '账号不存在' }
      if (account.session_status !== 'logged_in') {
        return { success: false, error: '账号未登录，请先登录' }
      }

      // Create publish record
      const recordRepo = getPublishRecordRepository()
      const record = recordRepo.create({
        accountId: params.accountId,
        platform: params.platformId,
        title: '',
        description: '',
        videoPath: params.filePath
      })
      saveDatabase()

      const mainWindow = BrowserWindow.getAllWindows()[0]
      const mode = getEffectiveMode(params.platformId)

      logger.info(`[publish] Upload mode for ${params.platformId}: ${mode}`)

      if (mode === 'api' && adapter.uploadVideoAPI) {
        // API mode — fast, no browser needed
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

        await adapter.uploadVideoAPI(client, params.filePath, (progress) => {
          recordRepo.updateStatus(record.id, 'uploading', progress.percent)
          saveDatabase()
          mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
            recordId: record.id,
            ...progress
          })
        })
      } else {
        // Browser mode — legacy Playwright automation
        if (!adapter.uploadVideo) {
          return { success: false, error: `平台 ${params.platformId} 暂不支持发布` }
        }

        const context = await browserManager.getContext(params.platformId)
        await cookieStore.loadCookies(context, params.accountId)

        await adapter.uploadVideo(context, params.filePath, (progress) => {
          recordRepo.updateStatus(record.id, 'uploading', progress.percent)
          saveDatabase()
          mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
            recordId: record.id,
            ...progress
          })
        })

        await browserManager.close()
      }

      recordRepo.updateStatus(record.id, 'uploaded', 100)
      saveDatabase()

      return { success: true, data: { recordId: record.id } }
    } catch (err) {
      logger.error('PUBLISH_UPLOAD error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Submit content (title, description, etc.)
  ipcMain.handle(IPC_CHANNELS.PUBLISH_SUBMIT, async (_event, params: {
    recordId: string
    platformId: string
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
    try {
      const adapter = getAdapter(params.platformId)
      if (!adapter) {
        return { success: false, error: `不支持的平台: ${params.platformId}` }
      }

      const recordRepo = getPublishRecordRepository()
      const record = recordRepo.getById(params.recordId)
      if (!record) return { success: false, error: '发布记录不存在' }

      recordRepo.updateStatus(params.recordId, 'submitting', undefined)
      saveDatabase()

      const mainWindow = BrowserWindow.getAllWindows()[0]
      const mode = getEffectiveMode(params.platformId)

      logger.info(`[publish] Submit mode for ${params.platformId}: ${mode}`)

      mainWindow?.webContents.send(IPC_CHANNELS.PUBLISH_PROGRESS, {
        recordId: params.recordId,
        percent: 90,
        stage: '正在提交内容...'
      })

      if (mode === 'api' && adapter.submitContentAPI) {
        // API mode
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

        await adapter.submitContentAPI(client, params.content)
      } else {
        // Browser mode
        if (!adapter.submitContent) {
          return { success: false, error: `平台 ${params.platformId} 暂不支持提交内容` }
        }

        const context = await browserManager.getContext(params.platformId)
        await cookieStore.loadCookies(context, record.account_id)

        await adapter.submitContent(context, params.content)
        await browserManager.close()
      }

      recordRepo.updateStatus(params.recordId, 'done', 100)
      const now = new Date().toISOString()
      recordRepo['db'].run(
        'UPDATE publish_records SET title = ?, description = ?, hashtags = ?, declarations = ?, updated_at = ? WHERE id = ?',
        [params.content.title, params.content.description, JSON.stringify(params.content.hashtags), JSON.stringify(params.content.declarations), now, params.recordId]
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
      const recordRepo = getPublishRecordRepository()
      recordRepo.updateStatus(params.recordId, 'error', undefined, String(err))
      saveDatabase()
      await browserManager.close()
      return { success: false, error: String(err) }
    }
  })

  // Get platform-specific field definitions
  ipcMain.handle(IPC_CHANNELS.PUBLISH_GET_PLATFORM_FIELDS, async (_event, platformId: string): Promise<IpcResponse> => {
    try {
      const adapter = getAdapter(platformId)
      const fields = adapter?.getPlatformFields?.() ?? []
      return { success: true, data: fields }
    } catch (err) {
      logger.error('PUBLISH_GET_PLATFORM_FIELDS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // List publish records
  ipcMain.handle(IPC_CHANNELS.PUBLISH_LIST_RECORDS, async (): Promise<IpcResponse> => {
    try {
      const recordRepo = getPublishRecordRepository()
      const records = recordRepo.getAll()
      return { success: true, data: records }
    } catch (err) {
      logger.error('PUBLISH_LIST_RECORDS error:', err)
      return { success: false, error: String(err) }
    }
  })

  // Get/set publish mode
  ipcMain.handle(IPC_CHANNELS.PUBLISH_GET_MODE, async (): Promise<IpcResponse> => {
    return { success: true, data: { mode: getPublishMode() } }
  })

  ipcMain.handle(IPC_CHANNELS.PUBLISH_SET_MODE, async (_event, mode: string): Promise<IpcResponse> => {
    if (mode !== 'api' && mode !== 'browser') {
      return { success: false, error: '无效的发布模式' }
    }
    setPublishMode(mode)
    logger.info(`Publish mode set to: ${mode}`)
    return { success: true, data: { mode } }
  })

  logger.info('Publish IPC handlers registered')
}
