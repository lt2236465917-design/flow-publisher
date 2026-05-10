import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { WC_URLS } from './wc-urls'
import { WC_SELECTORS } from './wc-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import FormData from 'form-data'

// WeChat Channels API endpoints
const API = {
  userInfo: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth',
  videoUpload: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/upload',
  publish: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post'
}

export class WcApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'wechat-channels'
  readonly platformName = '视频号'
  readonly loginUrl = WC_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 2048,
      maxDurationSec: 1800,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv', 'mkv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'originalDeclaration',
        type: 'checkbox',
        label: '声明原创',
        defaultValue: false
      },
      {
        name: 'location',
        type: 'text',
        label: '位置信息',
        placeholder: '搜索位置'
      }
    ]
  }

  // --- Browser mode (legacy) ---

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[wechat-channels] Waiting for QR code...')
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$(WC_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[wechat-channels] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('channels.weixin.qq.com/platform/post')) {
      return true
    }
    const avatar = await page.$(WC_SELECTORS.loginSuccess)
    return avatar !== null
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const avatarEl = await page.$(WC_SELECTORS.avatarImg)
      const avatarUrl = avatarEl ? await avatarEl.getAttribute('src') ?? undefined : undefined
      const nameEl = await page.$(WC_SELECTORS.userName)
      const displayName = nameEl ? await nameEl.textContent() ?? undefined : undefined
      return { displayName: displayName || '视频号用户', avatarUrl }
    } catch {
      return { displayName: '视频号用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
      const response = await client.get<{ err_code: number; finder_user?: { nickname: string } }>(
        API.userInfo,
        undefined,
        {
          referer: WC_URLS.home,
          Origin: 'https://channels.weixin.qq.com'
        }
      )
      return response.data?.err_code === 0 && !!response.data?.finder_user
    } catch (err) {
      logger.error('[wechat-channels] checkSessionAPI error:', err)
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
    logger.info(`[wechat-channels] File MD5: ${fileMd5}, size: ${stats.size}`)

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
        err_code: number
        err_msg?: string
        data?: { video_id: string }
      }>(
        API.videoUpload,
        formData,
        {
          referer: WC_URLS.publish,
          Origin: 'https://channels.weixin.qq.com'
        },
        (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      )

      if (response.data.err_code !== 0) {
        throw new Error(`视频上传失败: ${response.data.err_msg || '未知错误'}`)
      }

      logger.info(`[wechat-channels] Video uploaded, video_id: ${response.data.data?.video_id}`)
      onProgress?.({ percent: 80, stage: '视频上传完成' })
    } catch (err) {
      logger.error('[wechat-channels] uploadVideoAPI error:', err)
      throw err
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload): Promise<void> {
    const params: Record<string, unknown> = {
      desc: payload.title + (payload.description ? '\n' + payload.description : ''),
      topic_list: payload.hashtags.map((tag) => ({ topic_name: tag })),
      original_flag: payload.declarations.includes('声明原创') ? 1 : 0
    }

    // Add cover if provided
    if (payload.coverPath && existsSync(payload.coverPath)) {
      params.cover_path = payload.coverPath
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.originalDeclaration) {
        params.original_flag = 1
      }
      if (payload.platformFields.location) {
        params.poi_info = { name: payload.platformFields.location }
      }
    }

    try {
      const response = await client.post<{
        err_code: number
        err_msg?: string
        data?: { feed_id: string }
      }>(
        API.publish,
        params,
        {
          referer: WC_URLS.publish,
          Origin: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data.err_code !== 0) {
        throw new Error(`内容提交失败: ${response.data.err_msg || '未知错误'}`)
      }

      logger.info(`[wechat-channels] Content submitted, feed_id: ${response.data.data?.feed_id}`)
    } catch (err) {
      logger.error('[wechat-channels] submitContentAPI error:', err)
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
