import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { KS_URLS } from './ks-urls'
import { KS_SELECTORS } from './ks-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream, readFileSync } from 'fs'
import { createHash } from 'crypto'

// Kuaishou Creator API endpoints (reverse-engineered from yixiaoer)
const API = {
  userInfo: 'https://cp.kuaishou.com/rest/cp/creator/pc/home/infoV2',
  uploadPre: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/pre',
  uploadFinish: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/finish',
  submit: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/submit'
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

  /**
   * Extract kuaishou.web.cp.api_ph from cookie.
   */
  private extractApiPh(cookie: string): string {
    const match = cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/)
    return match ? match[1] : require('crypto').randomUUID().replace(/-/g, '')
  }

  async checkSessionAPI(client: HttpClient): Promise<boolean> {
    try {
      const cookie = client.getCookieString()
      const apiPh = this.extractApiPh(cookie)
      const body = JSON.stringify({ 'kuaishou.web.cp.api_ph': apiPh })

      const response = await client.post<{ result: number; data?: { user_name: string } }>(
        API.userInfo,
        body,
        {
          referer: 'https://cp.kuaishou.com/article/publish/video',
          Origin: 'https://cp.kuaishou.com',
          'Content-Type': 'application/json'
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
  ): Promise<string> {
    if (!existsSync(filePath)) {
      throw new Error(`视频文件不存在: ${filePath}`)
    }

    const stats = statSync(filePath)
    const fileSizeMB = stats.size / (1024 * 1024)
    const constraints = this.getVideoConstraints()
    if (fileSizeMB > constraints.maxFileSizeMB) {
      throw new Error(`视频文件过大: ${fileSizeMB.toFixed(1)}MB，最大 ${constraints.maxFileSizeMB}MB`)
    }

    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    onProgress?.({ percent: 5, stage: '正在获取上传凭证...' })

    // Step 1: Get upload pre-info (upload token + domain)
    const preBody = JSON.stringify({ uploadType: 'video', 'kuaishou.web.cp.api_ph': apiPh })
    const preResponse = await client.post<{
      result: number
      data?: {
        uploadToken?: string
        uploadDomain?: string
        photoId?: string
      }
    }>(
      API.uploadPre,
      preBody,
      {
        referer: 'https://cp.kuaishou.com/article/publish/video',
        'Content-Type': 'application/json'
      }
    )

    if (preResponse.data?.result !== 1 || !preResponse.data?.data?.uploadToken) {
      throw new Error('获取上传凭证失败')
    }

    const { uploadToken, uploadDomain, photoId } = preResponse.data.data
    logger.info(`[kuaishou] Upload pre: token=${uploadToken?.substring(0, 10)}..., domain=${uploadDomain}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Upload video fragment
    const fileBuffer = readFileSync(filePath)
    const uploadHost = uploadDomain || 'upload.kuaishouzt.com'
    const fragmentUrl = `https://${uploadHost}/api/upload/fragment?upload_token=${uploadToken}&fragment_id=0`

    try {
      await client.request({
        method: 'POST',
        url: fragmentUrl,
        data: fileBuffer,
        headers: {
          'Content-Type': 'application/octet-stream',
          referer: 'https://cp.kuaishou.com/article/publish/video'
        },
        timeout: 300_000,
        onUploadProgress: (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      })
    } catch (err) {
      logger.error('[kuaishou] Fragment upload error:', err)
      throw new Error(`视频上传失败: ${err}`)
    }

    // Step 3: Finish upload
    const finishUrl = `https://${uploadHost}/api/upload/complete?upload_token=${uploadToken}&fragment_count=1`
    await client.get(finishUrl, undefined, {
      referer: 'https://cp.kuaishou.com/article/publish/video'
    })

    logger.info(`[kuaishou] Video uploaded, photoId: ${photoId}`)
    onProgress?.({ percent: 80, stage: '视频上传完成' })

    return photoId || uploadToken
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    const params: Record<string, unknown> = {
      photoId: videoId || '',
      caption: payload.title + (payload.description ? '\n' + payload.description : ''),
      topicIds: payload.hashtags,
      privacyType: 0,
      disableComment: false,
      'kuaishou.web.cp.api_ph': apiPh
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.challenges) {
        params.topicIds = [...(params.topicIds as string[]), ...(payload.platformFields.challenges as string[])]
      }
      if (payload.platformFields.localVisible) {
        params.privacyType = 1
      }
    }

    try {
      const response = await client.post<{
        result: number
        data?: { photoId: string }
        error_msg?: string
      }>(
        API.submit,
        JSON.stringify(params),
        {
          referer: 'https://cp.kuaishou.com/article/publish/video',
          Origin: 'https://cp.kuaishou.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data?.result !== 1) {
        throw new Error(`内容提交失败: ${response.data?.error_msg || '未知错误'}`)
      }

      logger.info(`[kuaishou] Content submitted, photoId: ${response.data?.data?.photoId}`)
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
