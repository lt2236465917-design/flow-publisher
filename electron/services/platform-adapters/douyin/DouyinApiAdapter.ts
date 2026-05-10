import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { getSignService } from '../../sign/SignService'
import { DOUYIN_URLS } from './douyin-urls'
import { DOUYIN_SELECTORS } from './douyin-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import FormData from 'form-data'

// Douyin Creator API endpoints
const API = {
  userInfo: 'https://creator.douyin.com/aweme/v1/creator/user/info/',
  videoUpload: 'https://creator.douyin.com/aweme/v1/video/upload/',
  videoCreate: 'https://creator.douyin.com/aweme/v1/video/create/',
  pollUpload: 'https://creator.douyin.com/aweme/v1/video/upload/poll/',
  draftSave: 'https://creator.douyin.com/aweme/v1/video/draft/save/',
  collections: 'https://creator.douyin.com/aweme/v1/collection/list/',
  poiSearch: 'https://creator.douyin.com/aweme/v1/poi/recommend/'
}

const COMMON_PARAMS = {
  aid: '1128',
  device_platform: 'web',
  cookie_enabled: 'true',
  screen_width: '1920',
  screen_height: '1080',
  browser_language: 'zh-CN',
  browser_platform: 'Win32',
  browser_name: 'Mozilla',
  browser_online: 'true',
  timezone_name: 'Asia/Shanghai'
}

export class DouyinApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'douyin'
  readonly platformName = '抖音'
  readonly loginUrl = DOUYIN_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 4096,
      maxDurationSec: 900,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv', 'mkv', 'wmv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      { name: 'collection', type: 'select', label: '合集选择', placeholder: '选择合集', options: [] },
      { name: 'mentions', type: 'tags', label: '@提及', placeholder: '输入要@的用户' },
      { name: 'poiLocation', type: 'text', label: 'POI 地点', placeholder: '搜索地点' },
      { name: 'miniApp', type: 'text', label: '小程序挂载', placeholder: '输入小程序 AppID' }
    ]
  }

  // --- Signature helpers ---

  /**
   * Add a_bogus signature to a Douyin API URL.
   * Uses the local SignService to generate the signature.
   */
  private async signUrl(url: string, cookie: string, body?: string): Promise<string> {
    try {
      const signService = getSignService()
      const signature = await signService.getSignature('douyin', cookie, body || '')
      if (!signature) return url

      const separator = url.includes('?') ? '&' : '?'
      return `${url}${separator}a_bogus=${encodeURIComponent(signature)}`
    } catch (err) {
      logger.warn('[douyin] Signature generation failed, proceeding without signature:', err)
      return url
    }
  }

  /**
   * Extract msToken from cookie string.
   */
  private extractMsToken(cookie: string): string {
    const match = cookie.match(/msToken=([^;]+)/)
    return match ? match[1] : `${Date.now()}randomtoken`
  }

  // --- Browser mode (legacy) ---

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[douyin] Waiting for QR code...')
    await delay(3000)
    for (let i = 0; i < 30; i++) {
      try {
        const qrEl = await page.$('div[class*="qrcode-wrapper"] img, div[class*="qrcode"] img, img[src*="qrcode"], img[src*="scan"]')
        if (qrEl) {
          const box = await qrEl.boundingBox()
          if (box && box.width > 50 && box.height > 50) {
            const screenshot = await qrEl.screenshot()
            logger.info('[douyin] QR code captured')
            return `data:image/png;base64,${screenshot.toString('base64')}`
          }
        }
      } catch {}
      await delay(1000)
    }
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    const url = page.url()
    if (url.includes('creator-micro/home') || url.includes('creator-micro/content/upload')) {
      return true
    }
    const hasQr = await page.$('div[class*="qrcode"], img[src*="qrcode"], canvas[class*="qr"]')
    if (hasQr) return false
    const hasLoginBtn = await page.$('button:has-text("登录"), div[class*="login-btn"]')
    if (hasLoginBtn) return false
    return false
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      const currentUrl = page.url()
      logger.info(`[douyin] extractAccountInfo: current URL = ${currentUrl}`)

      let nameFound = false
      try {
        await page.waitForFunction(() => {
          const els = document.querySelectorAll('[class*="name-"]')
          for (let i = 0; i < els.length; i++) {
            const t = els[i].textContent?.trim()
            if (t && t.length >= 2 && t.length <= 15 && els[i].children.length === 0) {
              const skip = ['关注', '粉丝', '获赞', '抖音号', '通知', '网址', '抖音', '官网']
              if (!skip.some(s => t.includes(s))) return true
            }
          }
          return false
        }, { timeout: 15000 })
        nameFound = true
      } catch {
        logger.warn('[douyin] Name element not found within 15s')
      }

      const result = await page.evaluate(() => {
        let avatarUrl: string | undefined
        const avatarEls = document.querySelectorAll('div[class*="avatar"], img[class*="avatar"], img[src*="avatar"]')
        for (let i = 0; i < avatarEls.length; i++) {
          const htmlEl = avatarEls[i] as HTMLElement
          const img = htmlEl.tagName === 'IMG' ? htmlEl : htmlEl.querySelector('img')
          const src = img ? (img as HTMLImageElement).src : ''
          const bg = htmlEl.style.backgroundImage || ''
          const url = src || bg.replace(/url\("?|"?\)/g, '')
          if (url && !url.includes('default') && url.startsWith('http')) {
            avatarUrl = url
            break
          }
        }

        let displayName: string | undefined
        const nameEls = document.querySelectorAll('[class*="name-"]')
        for (let i = 0; i < nameEls.length; i++) {
          const t = nameEls[i].textContent?.trim()
          if (t && t.length >= 2 && t.length <= 15 && nameEls[i].children.length === 0) {
            const skip = ['关注', '粉丝', '获赞', '抖音号', '通知', '网址', '抖音', '官网']
            if (!skip.some(s => t.includes(s))) {
              displayName = t
              break
            }
          }
        }

        return { displayName, avatarUrl }
      })

      logger.info(`[douyin] Extracted: name=${result.displayName}, avatar=${result.avatarUrl ? 'yes' : 'no'}, nameFound=${nameFound}`)
      return { displayName: result.displayName || '抖音用户', avatarUrl: result.avatarUrl }
    } catch (e) {
      logger.error('[douyin] extractAccountInfo error:', e)
      return { displayName: '抖音用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(DOUYIN_URLS.creatorHome, { waitUntil: 'domcontentloaded', timeout: 15000 })
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
      const cookie = client.getCookieString()
      const msToken = this.extractMsToken(cookie)
      const baseUrl = `${API.userInfo}?${new URLSearchParams({
        ...COMMON_PARAMS,
        no_cache: Date.now().toString().substring(0, 10),
        msToken
      }).toString()}`
      const signedUrl = await this.signUrl(baseUrl, cookie)

      const response = await client.get<{ status_code: number; user?: { nickname: string } }>(
        signedUrl,
        undefined,
        {
          referer: 'https://creator.douyin.com/creator-micro/home',
          Origin: 'https://creator.douyin.com'
        }
      )
      return response.data?.status_code === 0 && !!response.data?.user
    } catch (err) {
      logger.error('[douyin] checkSessionAPI error:', err)
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

    // Step 1: Compute file MD5 for deduplication
    const fileMd5 = await this.computeFileMd5(filePath)
    logger.info(`[douyin] File MD5: ${fileMd5}, size: ${stats.size}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Upload video via multipart form
    const fileName = basename(filePath)
    const formData = new FormData()
    formData.append('video', createReadStream(filePath), {
      filename: fileName,
      contentType: 'video/mp4',
      knownLength: stats.size
    })
    formData.append('file_name', fileName)
    formData.append('file_size', stats.size.toString())
    formData.append('file_md5', fileMd5)
    formData.append('source', '3')

    // Sign the upload URL
    const cookie = client.getCookieString()
    const signedUploadUrl = await this.signUrl(API.videoUpload, cookie)

    try {
      const response = await client.uploadFile<{
        status_code: number
        video?: { vid: string; video_id: string }
        error?: string
      }>(
        signedUploadUrl,
        formData,
        {
          referer: DOUYIN_URLS.publish,
          Origin: 'https://creator.douyin.com'
        },
        (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      )

      if (response.data.status_code !== 0) {
        throw new Error(`视频上传失败: ${response.data.error || '未知错误'}`)
      }

      logger.info(`[douyin] Video uploaded, vid: ${response.data.video?.vid}`)
      onProgress?.({ percent: 80, stage: '视频上传完成' })
    } catch (err) {
      logger.error('[douyin] uploadVideoAPI error:', err)
      throw err
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload): Promise<void> {

    const params: Record<string, unknown> = {
      ...COMMON_PARAMS,
      title: payload.title,
      description: payload.description || '',
      text_extra: payload.hashtags.map((tag) => ({
        type: 1,
        hashtag_name: tag,
        hashtag_id: '',
        start: -1,
        end: -1
      })),
      creation_id: Date.now().toString(),
      creation_type: 1,
      is_unicast: 0,
      private_type: 0,
      draft: 0,
      source: 3
    }

    // Add cover if provided
    if (payload.coverPath && existsSync(payload.coverPath)) {
      params.cover_image_path = payload.coverPath
    }

    // Add declarations
    if (payload.declarations.length > 0) {
      params.protocol_list = payload.declarations
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.collection) {
        params.collection_id = payload.platformFields.collection
      }
      if (payload.platformFields.poiLocation) {
        params.poi_info = payload.platformFields.poiLocation
      }
    }

    try {
      // Sign the create URL
      const cookie = client.getCookieString()
      const signedCreateUrl = await this.signUrl(API.videoCreate, cookie, JSON.stringify(params))

      const response = await client.post<{
        status_code: number
        status_msg?: string
        item?: { aweme_id: string }
      }>(
        signedCreateUrl,
        params,
        {
          referer: DOUYIN_URLS.publish,
          Origin: 'https://creator.douyin.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data.status_code !== 0) {
        throw new Error(`内容提交失败: ${response.data.status_msg || '未知错误'}`)
      }

      logger.info(`[douyin] Content submitted, aweme_id: ${response.data.item?.aweme_id}`)
    } catch (err) {
      logger.error('[douyin] submitContentAPI error:', err)
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
