import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { XHS_URLS } from './xhs-urls'
import { XHS_SELECTORS } from './xhs-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream, readFileSync } from 'fs'
import { createHash } from 'crypto'

// Xiaohongshu Creator API endpoints (reverse-engineered from yixiaoer)
const API = {
  userInfo: 'https://creator.xiaohongshu.com/api/galaxy/user/info',
  uploadPermit: 'https://creator.xiaohongshu.com/api/media/v1/upload/web/permit',
  noteCreate: 'https://edith.xiaohongshu.com/web_api/sns/v2/note',
  personalInfo: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info'
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
          referer: 'https://creator.xiaohongshu.com/publish/publish',
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

    onProgress?.({ percent: 5, stage: '正在获取上传凭证...' })

    // Step 1: Get upload permit (response uses uploadTempPermits array)
    const permitResponse = await client.get<{
      data?: {
        uploadTempPermits?: Array<{
          uploadAddr?: string
          fileIds?: string[]
          token?: string
        }>
      }
    }>(
      `${API.uploadPermit}?biz_name=spectrum&scene=video&file_count=1&version=1&source=web`,
      undefined,
      {
        referer: 'https://creator.xiaohongshu.com/publish/publish',
        Authorization: ''
      }
    )

    const permit = permitResponse.data?.data?.uploadTempPermits?.[0]
    if (!permit?.uploadAddr || !permit?.fileIds?.length) {
      throw new Error('获取上传凭证失败')
    }

    const fileId = permit.fileIds[0]
    const uploadAddr = permit.uploadAddr
    const token = permit.token || ''

    logger.info(`[xiaohongshu] Upload permit: host=${uploadAddr}, fileId=${fileId}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Multipart upload (matching yixiaoer's PUT-based COS flow)
    const fileBuffer = readFileSync(filePath)
    const baseUploadUrl = `https://${uploadAddr}/${fileId}`
    const commonHeaders: Record<string, string> = {
      'x-cos-security-token': token,
      referer: 'https://creator.xiaohongshu.com/'
    }

    // Step 2a: Init multipart upload — GET ?uploads to get uploadId
    const initResponse = await client.request<{ uploadId?: string }>({
      method: 'GET',
      url: `${baseUploadUrl}?uploads`,
      headers: { ...commonHeaders, 'Content-Type': 'video/mp4' },
      noCookie: true
    })
    const uploadId = initResponse.data?.uploadId
    if (!uploadId) {
      throw new Error('初始化分片上传失败')
    }
    logger.info(`[xiaohongshu] Multipart upload initiated, uploadId: ${uploadId}`)

    // Step 2b: Upload parts (5MB each)
    const PART_SIZE = 5 * 1024 * 1024
    const totalParts = Math.ceil(stats.size / PART_SIZE)
    const etags: string[] = []

    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE
      const end = Math.min(start + PART_SIZE, stats.size)
      const part = fileBuffer.subarray(start, end)
      const partNumber = i + 1

      const partResponse = await client.request<{ ETag?: string }>({
        method: 'PUT',
        url: `${baseUploadUrl}?partNumber=${partNumber}&uploadId=${uploadId}`,
        data: part,
        headers: { ...commonHeaders, 'Content-Type': 'application/octet-stream' },
        noCookie: true,
        timeout: 120_000
      })

      const etag = partResponse.headers?.etag || partResponse.data?.ETag || ''
      etags.push(etag)
      const percent = 10 + Math.round((partNumber / totalParts) * 65)
      onProgress?.({ percent, stage: `上传中 ${partNumber}/${totalParts}` })
    }

    logger.info(`[xiaohongshu] All ${totalParts} parts uploaded`)

    // Step 2c: Verify upload — GET ?uploadId to list parts
    await client.request({
      method: 'GET',
      url: `${baseUploadUrl}?uploadId=${uploadId}`,
      headers: commonHeaders,
      noCookie: true
    })

    // Step 2d: Complete multipart upload — POST with XML body
    const partsXml = etags
      .map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${etag}</ETag></Part>`)
      .join('')
    const completeXml = `<CompleteMultipartUpload>${partsXml}</CompleteMultipartUpload>`

    await client.request({
      method: 'POST',
      url: `${baseUploadUrl}?uploadId=${uploadId}`,
      data: completeXml,
      headers: {
        ...commonHeaders,
        'Content-Type': 'application/xml',
        'Content-MD5': createHash('md5').update(completeXml).digest('base64')
      },
      noCookie: true
    })

    logger.info(`[xiaohongshu] Multipart upload completed`)
    onProgress?.({ percent: 80, stage: '视频上传完成' })

    return fileId
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const params: Record<string, unknown> = {
      title: payload.title,
      desc: payload.description || '',
      note_type: 'video',
      at_user_list: [],
      topic_tag_list: payload.hashtags.map((tag) => ({ name: tag })),
      post_time: '',
      private_type: 0,
      video_id: videoId || ''
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
          referer: 'https://creator.xiaohongshu.com/publish/publish',
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
