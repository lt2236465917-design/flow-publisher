import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { KS_URLS } from './ks-urls'
import { KS_SELECTORS } from './ks-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import FormData from 'form-data'

// Kuaishou Creator API endpoints
const API = {
  userInfo: 'https://cp.kuaishou.com/rest/kd/upload/user/info',
  videoUpload: 'https://cp.kuaishou.com/rest/kd/upload/video',
  publish: 'https://cp.kuaishou.com/rest/kd/feed/publish'
}

export class KsApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'kuaishou'
  readonly platformName = '快手'
  readonly loginUrl = KS_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 2048,
      maxDurationSec: 600,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'challenges',
        type: 'tags',
        label: '话题挑战',
        placeholder: '输入话题挑战名称'
      },
      {
        name: 'magicEmoji',
        type: 'checkbox',
        label: '使用魔法表情',
        defaultValue: false
      },
      {
        name: 'localVisible',
        type: 'checkbox',
        label: '同城可见',
        defaultValue: false
      }
    ]
  }

  // --- Browser mode (legacy) ---

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[kuaishou] Waiting for QR code...')
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(KS_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[kuaishou] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('cp.kuaishou.com/article') || url.includes('cp.kuaishou.com/home')) {
      return true
    }
    const avatar = await page.$(KS_SELECTORS.loginSuccess)
    return avatar !== null
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const avatarEl = await page.$(KS_SELECTORS.avatarImg)
      const avatarUrl = avatarEl ? await avatarEl.getAttribute('src') ?? undefined : undefined
      const nameEl = await page.$(KS_SELECTORS.userName)
      const displayName = nameEl ? await nameEl.textContent() ?? undefined : undefined
      return { displayName: displayName || '快手用户', avatarUrl }
    } catch {
      return { displayName: '快手用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(KS_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await delay(3000)
      const isLoggedIn = await this.detectLoginSuccess(page)
      await page.close()
      return isLoggedIn
    } catch {
      return false
    }
  }

  // --- API mode (new) ---

  async checkSessionAPI(client: HttpClient): Promise<boolean> {
    try {
      const response = await client.get<{ result: number; data?: { user_name: string } }>(
        API.userInfo,
        undefined,
        {
          referer: KS_URLS.creatorHome,
          Origin: 'https://cp.kuaishou.com'
        }
      )
      return response.data?.result === 1 && !!response.data?.data
    } catch (err) {
      logger.error('[kuaishou] checkSessionAPI error:', err)
      return false
    }
  }

  async uploadVideoAPI(
    client: HttpClient,
    filePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<void> {
    if (!existsSync(filePath)) {
      throw new Error(`视频文件不存在: ${filePath}`)
    }

    const stats = statSync(filePath)
    const fileSizeMB = stats.size / (1024 * 1024)
    const constraints = this.getVideoConstraints()
    if (fileSizeMB > constraints.maxFileSizeMB) {
      throw new Error(`视频文件过大: ${fileSizeMB.toFixed(1)}MB，最大 ${constraints.maxFileSizeMB}MB`)
    }

    onProgress?.({ percent: 5, stage: '正在准备上传...' })

    const fileMd5 = await this.computeFileMd5(filePath)
    logger.info(`[kuaishou] File MD5: ${fileMd5}, size: ${stats.size}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    const fileName = basename(filePath)
    const formData = new FormData()
    formData.append('file', createReadStream(filePath), {
      filename: fileName,
      contentType: 'video/mp4',
      knownLength: stats.size
    })
    formData.append('file_name', fileName)
    formData.append('file_size', stats.size.toString())
    formData.append('file_md5', fileMd5)

    try {
      const response = await client.uploadFile<{
        result: number
        data?: { video_id: string }
        error_msg?: string
      }>(
        API.videoUpload,
        formData,
        {
          referer: KS_URLS.publish,
          Origin: 'https://cp.kuaishou.com'
        },
        (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      )

      if (response.data.result !== 1) {
        throw new Error(`视频上传失败: ${response.data.error_msg || '未知错误'}`)
      }

      logger.info(`[kuaishou] Video uploaded, video_id: ${response.data.data?.video_id}`)
      onProgress?.({ percent: 80, stage: '视频上传完成' })
    } catch (err) {
      logger.error('[kuaishou] uploadVideoAPI error:', err)
      throw err
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload): Promise<void> {
    const params: Record<string, unknown> = {
      caption: payload.title + (payload.description ? '\n' + payload.description : ''),
      topic_ids: payload.hashtags,
      privacy_type: 0,
      disable_comment: false
    }

    // Add cover if provided
    if (payload.coverPath && existsSync(payload.coverPath)) {
      params.cover_path = payload.coverPath
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.challenges) {
        params.challenge_ids = payload.platformFields.challenges
      }
      if (payload.platformFields.localVisible) {
        params.privacy_type = 1 //同城可见
      }
    }

    try {
      const response = await client.post<{
        result: number
        data?: { photo_id: string }
        error_msg?: string
      }>(
        API.publish,
        params,
        {
          referer: KS_URLS.publish,
          Origin: 'https://cp.kuaishou.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data.result !== 1) {
        throw new Error(`内容提交失败: ${response.data.error_msg || '未知错误'}`)
      }

      logger.info(`[kuaishou] Content submitted, photo_id: ${response.data.data?.photo_id}`)
    } catch (err) {
      logger.error('[kuaishou] submitContentAPI error:', err)
      throw err
    }
  }

  private async computeFileMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5')
      const stream = createReadStream(filePath)
      stream.on('data', (data) => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }
}
