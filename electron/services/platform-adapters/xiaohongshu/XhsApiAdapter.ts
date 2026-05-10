import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { XHS_URLS } from './xhs-urls'
import { XHS_SELECTORS } from './xhs-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import FormData from 'form-data'

// Xiaohongshu Creator API endpoints
const API = {
  userInfo: 'https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo',
  videoUpload: 'https://edith.xiaohongshu.com/api/sns/web/v1/upload/video',
  noteCreate: 'https://edith.xiaohongshu.com/api/sns/web/v1/feed/publish',
  draftSave: 'https://edith.xiaohongshu.com/api/sns/web/v1/feed/draft/save'
}

export class XhsApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'xiaohongshu'
  readonly platformName = '小红书'
  readonly loginUrl = XHS_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 4096,
      maxDurationSec: 900,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'noteType',
        type: 'select',
        label: '笔记类型',
        options: [
          { label: '视频笔记', value: 'video' },
          { label: '图文笔记', value: 'image' }
        ],
        defaultValue: 'video'
      },
      {
        name: 'productLinks',
        type: 'tags',
        label: '关联商品',
        placeholder: '输入商品名称或链接'
      },
      {
        name: 'location',
        type: 'text',
        label: '地点标注',
        placeholder: '搜索地点'
      }
    ]
  }

  // --- Browser mode (legacy) ---

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[xiaohongshu] Waiting for QR code...')
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(XHS_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[xiaohongshu] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('creator.xiaohongshu.com/publish') || url.includes('creator.xiaohongshu.com/home')) {
      return true
    }
    const avatar = await page.$(XHS_SELECTORS.loginSuccess)
    return avatar !== null
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const avatarEl = await page.$(XHS_SELECTORS.avatarImg)
      const avatarUrl = avatarEl ? await avatarEl.getAttribute('src') ?? undefined : undefined
      const nameEl = await page.$(XHS_SELECTORS.userName)
      const displayName = nameEl ? await nameEl.textContent() ?? undefined : undefined
      return { displayName: displayName || '小红书用户', avatarUrl }
    } catch {
      return { displayName: '小红书用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(XHS_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
      const response = await client.get<{ success: boolean; data?: { nickname: string } }>(
        API.userInfo,
        undefined,
        {
          referer: XHS_URLS.creatorHome,
          Origin: 'https://creator.xiaohongshu.com'
        }
      )
      return response.data?.success === true && !!response.data?.data
    } catch (err) {
      logger.error('[xiaohongshu] checkSessionAPI error:', err)
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
    logger.info(`[xiaohongshu] File MD5: ${fileMd5}, size: ${stats.size}`)

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
        success: boolean
        data?: { video_id: string }
        msg?: string
      }>(
        API.videoUpload,
        formData,
        {
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com'
        },
        (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      )

      if (!response.data.success) {
        throw new Error(`视频上传失败: ${response.data.msg || '未知错误'}`)
      }

      logger.info(`[xiaohongshu] Video uploaded, video_id: ${response.data.data?.video_id}`)
      onProgress?.({ percent: 80, stage: '视频上传完成' })
    } catch (err) {
      logger.error('[xiaohongshu] uploadVideoAPI error:', err)
      throw err
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload): Promise<void> {
    const params: Record<string, unknown> = {
      title: payload.title,
      desc: payload.description || '',
      note_type: 'video',
      at_user_list: [],
      topic_tag_list: payload.hashtags.map((tag) => ({ name: tag })),
      post_time: '',
      private_type: 0
    }

    // Add cover if provided
    if (payload.coverPath && existsSync(payload.coverPath)) {
      params.cover_image_path = payload.coverPath
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.noteType) {
        params.note_type = payload.platformFields.noteType
      }
      if (payload.platformFields.location) {
        params.poi_info = { name: payload.platformFields.location }
      }
    }

    try {
      const response = await client.post<{
        success: boolean
        data?: { note_id: string }
        msg?: string
      }>(
        API.noteCreate,
        params,
        {
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com',
          'Content-Type': 'application/json'
        }
      )

      if (!response.data.success) {
        throw new Error(`内容提交失败: ${response.data.msg || '未知错误'}`)
      }

      logger.info(`[xiaohongshu] Content submitted, note_id: ${response.data.data?.note_id}`)
    } catch (err) {
      logger.error('[xiaohongshu] submitContentAPI error:', err)
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
