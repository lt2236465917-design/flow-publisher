import type { BrowserContext, Page } from 'playwright-core'
import axios from 'axios'
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
import { getSignService } from '../../sign/SignService'

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

    // Step 2: Multipart upload (matching yixiaoer's Tencent COS flow)
    const fileBuffer = readFileSync(filePath)
    const baseUploadUrl = `https://${uploadAddr}/${fileId}`
    const commonHeaders: Record<string, string> = {
      'x-cos-security-token': token,
      referer: 'https://creator.xiaohongshu.com/',
      Origin: 'https://creator.xiaohongshu.com',
      Authorization: ''
    }

    // Step 2a: Init multipart upload — POST ?uploads with empty body to get uploadId
    // Response is XML containing <UploadId>...</UploadId>
    const initResponse = await client.request<string>({
      method: 'POST',
      url: `${baseUploadUrl}?uploads`,
      data: '',
      headers: { ...commonHeaders, 'Content-Type': 'video/mp4' },
      noCookie: true,
      responseType: 'text'
    })
    const initXml = typeof initResponse.data === 'string' ? initResponse.data : String(initResponse.data)
    const uploadIdMatch = initXml.match(/<UploadId>(.*?)<\/UploadId>/)
    const uploadId = uploadIdMatch?.[1]
    if (!uploadId) {
      logger.error(`[xiaohongshu] Multipart init response: ${initXml.substring(0, 500)}`)
      throw new Error('初始化分片上传失败：未获取到 uploadId')
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

      const partResponse = await client.request<string>({
        method: 'PUT',
        url: `${baseUploadUrl}?partNumber=${partNumber}&uploadId=${uploadId}`,
        data: part,
        headers: { ...commonHeaders, 'Content-Type': 'application/octet-stream' },
        noCookie: true,
        timeout: 120_000,
        responseType: 'text'
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
      noCookie: true,
      responseType: 'text'
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
      noCookie: true,
      responseType: 'text'
    })

    logger.info(`[xiaohongshu] Multipart upload completed`)
    onProgress?.({ percent: 80, stage: '视频上传完成' })

    return fileId
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    // Build body matching yixiaoer's common/video_info structure
    const body: Record<string, unknown> = {
      common: {
        type: 'video',
        title: payload.title || '',
        note_id: '',
        desc: payload.description || '',
        source: JSON.stringify({ type: 'web', ids: '', extraInfo: JSON.stringify({ systemId: 'web' }) }),
        business_binds: JSON.stringify({ version: 1, noteId: 0, bizType: 13 }),
        ats: [],
        biz_relations: [],
        hash_tag: payload.hashtags.map((tag) => ({
          id: '',
          name: tag,
          link: '',
          type: 'topic'
        })),
        privacy_info: { op_type: 1, type: 0 }
      },
      image_info: null,
      video_info: {
        file_id: videoId || '',
        fileid: videoId || '',
        format_width: 720,
        format_height: 1280,
        composite_metadata: {
          video: {
            bitrate: 0,
            colour_primaries: 'BT.709',
            duration: 0,
            format: 'AVC',
            frame_rate: 30,
            height: 1280,
            matrix_coefficients: 'BT.709',
            rotation: 0,
            transfer_characteristics: 'BT.709',
            width: 720
          },
          audio: { bitrate: 0, channels: 1, duration: 0, format: 'AAC', sampling_rate: 0 }
        },
        timelines: [],
        cover: { height: 1280, file_id: '', fileid: '', width: 720, frame: { ts: 0, is_user_select: false, is_upload: false } },
        chapters: [],
        chapter_sync_text: false,
        segments: { count: 1, need_slice: false, items: [] },
        entrance: 'web'
      }
    }

    // Add location if provided
    if (payload.platformFields?.location) {
      (body.common as Record<string, unknown>).post_loc = { poi_id: '', name: payload.platformFields.location }
    }

    try {
      let cookie = client.getCookieString()
      const bodyStr = JSON.stringify(body)
      const urlPath = '/web_api/sns/v2/note'
      const { headers: signHeaders, a1 } = await this.getXhsSignHeaders(urlPath, cookie, bodyStr)

      // Replace a1 cookie if signing returned a new one (matching yixiaoer)
      if (a1) {
        cookie = cookie.replace('a1=', 'a1old=')
        cookie = `${cookie};a1=${a1}`
      }

      logger.info(`[xiaohongshu] Submit headers: X-s=${signHeaders['X-s'] ? 'yes' : 'no'}, X-t=${signHeaders['X-t'] ? 'yes' : 'no'}, X-S-Common=${signHeaders['X-S-Common'] ? 'yes' : 'no'}, a1_replaced=${!!a1}`)

      // Use axios directly — bypass HttpClient's default BROWSER_HEADERS
      // (sec-ch-ua, Sec-Fetch-*, etc. may cause XHS to reject the request)
      const response = await axios.post<{
        success: boolean
        data?: { note_id: string }
        msg?: string
        code?: number
      }>(
        API.noteCreate,
        body,
        {
          headers: {
            cookie,
            referer: 'https://creator.xiaohongshu.com/',
            Origin: 'https://creator.xiaohongshu.com',
            Authorization: '',
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/110.0.0.0',
            ...signHeaders
          },
          timeout: 30_000,
          responseType: 'json'
        }
      )

      logger.info(`[xiaohongshu] Submit response: ${JSON.stringify(response.data).substring(0, 500)}`)

      if (!response.data.success) {
        throw new Error(`内容提交失败: ${response.data.msg || JSON.stringify(response.data).substring(0, 200)}`)
      }

      logger.info(`[xiaohongshu] Content submitted, note_id: ${response.data.data?.note_id}`)
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        const data = err.response?.data
        logger.error(`[xiaohongshu] Submit HTTP error: ${status}`, JSON.stringify(data).substring(0, 500))
        throw new Error(`内容提交失败: HTTP ${status} ${JSON.stringify(data).substring(0, 200)}`)
      }
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

  /**
   * Generate XHS request signature headers.
   *
   * Primary: yixiaoer external signing service (ports 5061-5063, newxiaohongshu).
   * Returns X-s, X-t, X-S-Common, and optionally a1 cookie.
   *
   * Fallback: local MD5 signing (no X-S-Common).
   */
  private async getXhsSignHeaders(
    urlPath: string,
    cookie: string,
    body?: string
  ): Promise<{ headers: Record<string, string>; a1?: string }> {
    // Primary: try yixiaoer external signing service (returns X-S-Common)
    const signPorts = ['5061', '5062', '5063']
    const signBase = 'http://qianming.yixiaoer.cn'

    for (let i = 0; i < 3; i++) {
      try {
        const port = signPorts[i]
        const url = `${signBase}:${port}/Sign/GetSign`
        const cookieArr: string[] = [urlPath]
        if (body) {
          cookieArr.push(encodeURIComponent(body))
        }
        const payload = {
          url: '',
          cookie: JSON.stringify(cookieArr),
          signType: 'browser',
          signCommand: 'newxiaohongshu'
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        })
        clearTimeout(timeout)

        const result = (await resp.json()) as { signature?: string }
        let signature = result.signature?.toString().replace(/\\/g, '"')

        // Retry once if first attempt returned empty
        if (!signature) {
          await delay(1000)
          const retryController = new AbortController()
          const retryTimeout = setTimeout(() => retryController.abort(), 10_000)
          const retryResp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: retryController.signal
          })
          clearTimeout(retryTimeout)
          const retryResult = (await retryResp.json()) as { signature?: string }
          signature = retryResult.signature?.toString().replace(/\\/g, '"')
        }

        if (signature) {
          const parsed = JSON.parse(signature) as {
            'X-s'?: string
            'X-t'?: string
            'X-S-Common'?: string
            a1?: string
          }
          if (parsed['X-s'] && parsed['X-t']) {
            const headers: Record<string, string> = {
              'X-s': parsed['X-s'],
              'X-t': String(parsed['X-t'])
            }
            if (parsed['X-S-Common']) {
              headers['X-S-Common'] = parsed['X-S-Common']
            }
            logger.info(`[xiaohongshu] Sign from port ${port}, X-S-Common: ${parsed['X-S-Common'] ? 'yes' : 'no'}, has a1: ${!!parsed.a1}`)
            return { headers, a1: parsed.a1 }
          }
        }
        await delay(1000)
      } catch (err) {
        logger.warn(`[xiaohongshu] Sign attempt ${i + 1} failed:`, err)
      }
    }

    // Fallback: local MD5 signing (no X-S-Common)
    logger.warn('[xiaohongshu] External signing failed, using local algorithm (no X-S-Common)')
    return { headers: this.localXhsSign(urlPath, body) }
  }

  /**
   * Local XHS signing: X-s = customBase64(MD5(timestamp + "iamspam" + urlPath + bodyStr))
   * Matches yixiaoer's getSign / getSign$6 implementation.
   */
  private localXhsSign(urlPath: string, body?: string): Record<string, string> {
    const XHS_SIGN_SALT = 'iamspam'
    const CUSTOM_B64_ALPHABET = 'A4NjFqYu5wPHsO0XTdDgMa2r1ZQocVte9UJBvk6/7=yRnhISGKblCWi+LpfE8xzm3'

    const timestamp = Date.now()
    const bodyStr = body || ''
    const data = `${timestamp}${XHS_SIGN_SALT}${urlPath}${bodyStr}`
    const md5Hex = createHash('md5').update(data).digest('hex')

    // Custom base64 encode the MD5 hex string
    const inputBytes = Buffer.from(md5Hex, 'utf-8')
    let result = ''
    for (let i = 0; i < inputBytes.length; i += 3) {
      const b0 = inputBytes[i]
      const b1 = i + 1 < inputBytes.length ? inputBytes[i + 1] : 0
      const b2 = i + 2 < inputBytes.length ? inputBytes[i + 2] : 0
      result += CUSTOM_B64_ALPHABET[(b0 >> 2) & 0x3f]
      result += CUSTOM_B64_ALPHABET[((b0 << 4) | (b1 >> 4)) & 0x3f]
      result += i + 1 < inputBytes.length ? CUSTOM_B64_ALPHABET[((b1 << 2) | (b2 >> 6)) & 0x3f] : '='
      result += i + 2 < inputBytes.length ? CUSTOM_B64_ALPHABET[b2 & 0x3f] : '='
    }

    logger.info(`[xiaohongshu] Local signing: X-s=${result.substring(0, 10)}..., X-t=${timestamp}`)
    return {
      'X-s': result,
      'X-t': String(timestamp)
    }
  }
}
