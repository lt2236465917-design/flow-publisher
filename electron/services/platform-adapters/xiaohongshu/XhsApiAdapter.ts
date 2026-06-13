import type { BrowserContext, Page } from 'playwright-core'
import axios from 'axios'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, UploadResult, VideoConstraints, VideoMetadata } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { SubmitResult } from '../../../../shared/types/analytics'
import { HttpClient } from '../../http/HttpClient'
import { XHS_URLS } from './xhs-urls'
import { XHS_SELECTORS } from './xhs-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { getSignService } from '../../sign/SignService'
import { openChunkedReader } from '../../../utils/chunked-reader'
import { getPublishRecordRepository } from '../../database'

// Xiaohongshu Creator API endpoints (reverse-engineered from yixiaoer)
const API = {
  userInfo: 'https://creator.xiaohongshu.com/api/galaxy/user/info',
  uploadCreatorPermit: 'https://creator.xiaohongshu.com/api/media/v1/upload/creator/permit',
  uploadWebPermit: 'https://creator.xiaohongshu.com/api/media/v1/upload/web/permit',
  noteCreate: 'https://edith.xiaohongshu.com/web_api/sns/v2/note',
  personalInfo: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info',
  collectionList: 'https://edith.xiaohongshu.com/api/sns/v1/note/collection/pc/list_v2',
  locationSearch: 'https://edith.xiaohongshu.com/web_api/sns/v1/local/poi/creator/search',
  locationSearchV5: 'https://www.xiaohongshu.com/web_api/sns/v5/creator/poi/search'
}

type XhsSubmitResponse = {
  success?: boolean
  code?: number
  msg?: string
  data?: Record<string, unknown>
}

type XhsUploadPermit = {
  uploadAddr?: string
  fileIds?: string[]
  token?: string
}

type XhsValidUploadPermit = XhsUploadPermit & {
  uploadAddr: string
  fileIds: [string, ...string[]]
}

type XhsUploadPermitResponse = {
  success?: boolean
  code?: number
  msg?: string
  message?: string
  data?: {
    uploadTempPermits?: XhsUploadPermit[]
  }
  uploadTempPermits?: XhsUploadPermit[]
}

export class XhsApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'xiaohongshu'
  readonly platformName = '小红书'
  readonly loginUrl = XHS_URLS.login

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 500,
      maxDurationSec: 900,
      supportedFormats: ['mp4', 'mov', 'avi', 'flv']
    }
  }

  getPlatformFields(): PlatformFieldDefinition[] {
    return [
      {
        name: 'collection',
        type: 'dynamic-select',
        label: '合集',
        placeholder: '选择合集',
        dynamicKey: 'collections'
      },
      {
        name: 'location',
        type: 'location',
        label: '位置',
        placeholder: '搜索地点'
      },
      {
        name: 'contentTypeDeclaration',
        type: 'checkbox-group',
        label: '内容类型声明',
        maxSelections: 1,
        options: [
          { label: '虚构演绎，仅供娱乐', value: '虚构演绎' },
          { label: '笔记含AI合成内容', value: 'AI合成' },
          { label: '内容包含营销广告', value: '营销广告' }
        ]
      },
      {
        name: 'originalDeclaration',
        type: 'checkbox',
        label: '原创声明',
        defaultValue: false
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
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com'
        }
      )
      return response.data?.success === true && !!response.data?.data
    } catch (err) {
      logger.error('[xiaohongshu] checkSessionAPI error:', err)
      return false
    }
  }

  async getAccountInfoAPI(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null> {
    try {
      const response = await client.get<{
        success: boolean
        data?: {
          userId: string
          userName: string
          userAvatar: string
          nickname?: string
          name?: string
          imageb?: string
          avatar?: string
        }
      }>(
        API.userInfo,
        undefined,
        {
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com'
        }
      )

      logger.info(`[xiaohongshu] getAccountInfoAPI response: ${JSON.stringify(response.data).substring(0, 500)}`)

      if (response.data?.success && response.data?.data) {
        const data = response.data.data
        // API 返回的字段名是 userName 和 userAvatar
        const nickname = data.userName || data.nickname || data.name || ''
        const avatarUrl = data.userAvatar || data.imageb || data.avatar || ''
        logger.info(`[xiaohongshu] getAccountInfoAPI: nickname=${nickname}, avatarUrl=${avatarUrl ? 'yes' : 'no'}`)
        return {
          displayName: nickname || undefined,
          avatarUrl: avatarUrl || undefined
        }
      }

      logger.warn(`[xiaohongshu] getAccountInfoAPI failed: success=${response.data?.success}`)
      return null
    } catch (err) {
      logger.error('[xiaohongshu] getAccountInfoAPI error:', err)
      return null
    }
  }

  /**
   * Fetch user's collection list from Xiaohongshu creator API.
   * Uses the same signing mechanism as note creation.
   * API endpoint: /api/sns/v1/note/collection/pc/list_v2
   */
  async getCollections(client: HttpClient): Promise<Array<{ label: string; value: string }>> {
    try {
      const cookie = client.getCookieString()
      logger.info(`[xiaohongshu] getCollections called, cookie length: ${cookie.length}`)

      const urlPath = '/api/sns/v1/note/collection/pc/list_v2'
      const bodyStr = JSON.stringify({ cursor: '', need_type_list: [0], target_uid: '' })

      logger.info('[xiaohongshu] Fetching collection list via authenticated browser API')
      const response = await getSignService().postXhsInBuiltinBrowser(
        cookie,
        urlPath,
        bodyStr,
        { 'Content-Type': 'application/json;charset=UTF-8' },
        client.getAccountId()
      )
      if (!response) {
        logger.warn('[xiaohongshu] Collections browser request unavailable')
        return []
      }
      if (response.status === 403 || response.status === 406) {
        logger.warn(
          `[xiaohongshu] Collections browser request rejected: HTTP ${response.status}, ` +
          `signKeys=${response.signKeys?.join(',') || 'none'}, ` +
          `X-S-Common=${response.hasXSCommon ? 'yes' : 'no'}, ` +
          `body=${response.text.substring(0, 300)}`
        )
        return []
      }
      if (response.status < 200 || response.status >= 300) {
        logger.warn(`[xiaohongshu] Collections browser request failed: HTTP ${response.status}, body=${response.text.substring(0, 300)}`)
        return []
      }

      let data: {
        result: number
        msg: string
        data?: {
          collection_info_list?: Array<{
            id?: number
            name?: string
            desc?: string
            icon?: string
            view_num?: number
          }>
        }
      }
      try {
        data = JSON.parse(response.text)
      } catch {
        logger.warn(`[xiaohongshu] Collections returned non-JSON: ${response.text.substring(0, 300)}`)
        return []
      }

      logger.info(`[xiaohongshu] Collections response: result=${data.result}, msg=${data.msg}, hasData=${!!data.data}, hasList=${!!data.data?.collection_info_list}`)

      if (data.result !== 0 || !data.data?.collection_info_list) {
        logger.warn(`[xiaohongshu] Collections fetch failed: ${data.msg}`)
        return []
      }

      return data.data.collection_info_list
        .filter((c) => c.id && c.name)
        .map((c) => ({
          label: c.name!,
          value: c.id!.toString()
        }))
    } catch (err: any) {
      if (err?.response) {
        logger.error(`[xiaohongshu] getCollections error: status=${err.response.status}, data=${JSON.stringify(err.response.data)?.substring(0, 500)}`)
      } else {
        logger.error('[xiaohongshu] getCollections error:', err?.message || err)
      }
      return []
    }
  }

  async uploadVideoAPI(
    client: HttpClient,
    filePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<UploadResult> {
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
    const permit = await this.getXhsUploadPermit(client, 'video')

    const fileId = permit.fileIds[0]
    const uploadAddr = permit.uploadAddr
    const token = permit.token || ''

    logger.info(`[xiaohongshu] Upload permit: host=${uploadAddr}, fileId=${fileId}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Multipart upload (matching yixiaoer's Tencent COS flow)
    // Use chunked reader — reads each chunk on-demand, never loads entire file into memory
    const PART_SIZE = 8 * 1024 * 1024 // 8MB — matching yixiaoer's chunk size
    const reader = await openChunkedReader(filePath, PART_SIZE)
    const totalParts = reader.totalChunks

    const baseUploadUrl = `https://${uploadAddr}/${fileId}`
    const commonHeaders: Record<string, string> = {
      'x-cos-security-token': token,
      referer: 'https://creator.xiaohongshu.com/',
      Origin: 'https://creator.xiaohongshu.com',
      Authorization: ''
    }

    try {

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

    // Step 2b: Upload parts (8MB each — matching yixiaoer's chunk size)
    const etags: string[] = new Array(totalParts)
    let completedParts = 0

    const uploadPart = async (i: number, maxRetries = 3) => {
      const part = await reader.readChunk(i)
      const partNumber = i + 1

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const partResponse = await client.request<string>({
            method: 'PUT',
            url: `${baseUploadUrl}?partNumber=${partNumber}&uploadId=${uploadId}`,
            data: part,
            headers: { ...commonHeaders, 'Content-Type': 'application/octet-stream' },
            noCookie: true,
            timeout: 120_000,
            responseType: 'text'
          })

          const rawEtag = partResponse.headers?.etag || partResponse.data?.ETag || ''
          if (!rawEtag) {
            throw new Error(`上传分片 ${partNumber} 成功但未返回 ETag`)
          }
          const normalizedEtag = rawEtag.replace(/^"|"$/g, '')
          const etag = `"${normalizedEtag}"`
          etags[i] = etag
          completedParts++
          const percent = 10 + Math.round((completedParts / totalParts) * 65)
          onProgress?.({ percent, stage: `上传中 ${completedParts}/${totalParts}` })
          return
        } catch (err: any) {
          const isRetryable = err.message?.includes('timeout') || err.message?.includes('ECONNRESET') || err.message?.includes('network')
          if (isRetryable && attempt < maxRetries - 1) {
            logger.warn(`[xiaohongshu] Part ${partNumber} attempt ${attempt + 1} failed (${err.message}), retrying...`)
            await delay(1000 * (attempt + 1))
          } else {
            throw err
          }
        }
      }
    }

    // Sequential upload (simpler, more reliable — matching yixiaoer's default behavior)
    for (let i = 0; i < totalParts; i++) {
      await uploadPart(i)
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

    const completeResponse = await client.request<string>({
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
    const completeText = typeof completeResponse.data === 'string' ? completeResponse.data : String(completeResponse.data || '')
    logger.info(`[xiaohongshu] Multipart complete response: status=${completeResponse.status}, body=${completeText.substring(0, 500)}`)

    logger.info(`[xiaohongshu] Multipart upload completed`)

    } finally {
      await reader.close()
    }

    onProgress?.({ percent: 80, stage: '视频上传完成，正在等待平台处理...' })

    const readyInfo = await this.waitForUploadedVideoReady(client, fileId, onProgress)

    return {
      videoId: fileId,
      meta: {
        fileId,
        xhsVideoId: readyInfo.videoId,
        firstFrameFileId: readyInfo.firstFrameFileId,
        transcodeVideoFileId: readyInfo.transcodeVideoFileId,
        uploadAddr
      }
    }
  }

  private async waitForUploadedVideoReady(
    client: HttpClient,
    fileId: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<{ videoId: string; firstFrameFileId?: string; transcodeVideoFileId?: string }> {
    onProgress?.({ percent: 82, stage: '正在生成小红书视频ID...' })
    const videoId = await this.generateXhsVideoId(client, fileId)
    logger.info(`[xiaohongshu] Generated videoId=${videoId} for fileId=${fileId}`)

    onProgress?.({ percent: 84, stage: '等待小红书处理视频首帧...' })
    await delay(3000)

    let lastPayload: Record<string, unknown> | null = null
    for (let attempt = 1; attempt <= 20; attempt++) {
      const payload = await this.queryXhsTranscode(client, videoId, false)
      lastPayload = payload
      const hasFirstFrame = this.readBooleanField(payload, ['hasFirstFrame', 'has_first_frame'])
      const firstFrameFileId = this.readStringField(payload, ['firstFrameFileId', 'first_frame_file_id'])
      const transcodeVideoFileId = this.readStringField(payload, ['transcodeVideoFileId', 'transcode_video_file_id'])
      const progress = this.readStringField(payload, ['transProgressInfo.progress', 'trans_progress_info.progress'])
      logger.info(
        `[xiaohongshu] query_transcode attempt ${attempt}: ` +
        `hasFirstFrame=${hasFirstFrame ? 'yes' : 'no'}, ` +
        `firstFrameFileId=${firstFrameFileId || 'none'}, ` +
        `transcodeVideoFileId=${transcodeVideoFileId || 'none'}, progress=${progress || 'n/a'}`
      )

      if (hasFirstFrame) {
        onProgress?.({ percent: 88, stage: '小红书视频处理完成' })
        return { videoId, firstFrameFileId, transcodeVideoFileId }
      }

      const percent = Math.min(87, 84 + Math.floor(attempt / 4))
      onProgress?.({ percent, stage: `等待小红书处理视频首帧...(${attempt}/20)` })
      await delay(3000)
    }

    throw new Error(
      `小红书视频处理超时: 已生成 videoId=${videoId}，但 query_transcode 一直未返回首帧。` +
      `最后响应=${JSON.stringify(lastPayload).substring(0, 300)}`
    )
  }

  private async generateXhsVideoId(client: HttpClient, fileId: string): Promise<string> {
    let lastError = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const urlPath = `/web_api/sns/capa/postgw/videoid?fileKey=${encodeURIComponent(fileId)}&bizName=217`
        const response = await this.getXhsSignedJson(client, urlPath)
        const payload = this.extractXhsDataObject(response)
        const videoId = this.readStringField(payload, ['videoId', 'video_id'])
        logger.info(`[xiaohongshu] videoid response attempt ${attempt}: ${JSON.stringify(response).substring(0, 500)}`)
        if (videoId && videoId !== '-1') return videoId
        lastError = JSON.stringify(response).substring(0, 300)
      } catch (err: any) {
        lastError = err?.message || String(err)
        logger.warn(`[xiaohongshu] generate videoId attempt ${attempt} failed: ${lastError}`)
      }
      await delay(1500 * attempt)
    }
    throw new Error(`小红书生成 videoId 失败: fileId=${fileId}, last=${lastError}`)
  }

  private async queryXhsTranscode(client: HttpClient, videoId: string, needTranscode: boolean): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({
      videoId,
      needTranscode: String(needTranscode),
      resourceType: '0'
    })
    const response = await this.getXhsSignedJson(client, `/web_api/sns/capa/postgw/query_transcode?${params.toString()}`)
    return this.extractXhsDataObject(response)
  }

  private async getXhsSignedJson(client: HttpClient, urlPath: string): Promise<Record<string, unknown>> {
    const cookie = client.getCookieString()
    const browserResult = await getSignService().getXhsInBuiltinBrowser(
      cookie,
      urlPath,
      { Accept: 'application/json, text/plain, */*' },
      client.getAccountId()
    )

    if (browserResult) {
      const status = Number(browserResult.status || 0)
      const text = browserResult.text || ''
      logger.info(
        `[xiaohongshu] Browser GET ${urlPath} returned HTTP ${status}, ` +
        `text=${text.substring(0, 300)}`
      )
      if (status >= 200 && status < 300) {
        try {
          const parsed = JSON.parse(text) as unknown
          if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
        } catch {
          throw new Error(`小红书浏览器 GET 返回非 JSON: ${text.substring(0, 300)}`)
        }
      }

      if (status !== 0) {
        throw new Error(`小红书浏览器 GET 失败: HTTP ${status} ${text.substring(0, 300)}`)
      }
      logger.warn(`[xiaohongshu] Browser GET ${urlPath} returned status=0, falling back to signed HTTP`)
    }

    let signHeaders: Record<string, string>
    try {
      signHeaders = (await this.getXhsSignHeaders(urlPath, cookie, undefined, client.getAccountId())).headers
    } catch (err: any) {
      const detail = err?.message || String(err)
      logger.warn(`[xiaohongshu] Signed GET ${urlPath} using basic local X-s/X-t fallback: ${detail}`)
      signHeaders = this.localXhsSign(urlPath)
    }

    const response = await axios.get<Record<string, unknown>>(
      `https://edith.xiaohongshu.com${urlPath}`,
      {
        headers: {
          cookie,
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com',
          Authorization: '',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14',
          ...signHeaders
        },
        timeout: 30_000,
        responseType: 'json'
      }
    )
    return response.data
  }

  private async getXhsUploadPermit(
    client: HttpClient,
    scene: 'video' | 'image'
  ): Promise<XhsValidUploadPermit> {
    const endpoints = [
      { name: 'creator', url: API.uploadCreatorPermit },
      { name: 'web', url: API.uploadWebPermit }
    ]
    const failures: string[] = []

    for (const endpoint of endpoints) {
      try {
        const response = await client.get<XhsUploadPermitResponse>(
          `${endpoint.url}?biz_name=spectrum&scene=${scene}&file_count=1&version=1&source=web`,
          undefined,
          {
            referer: XHS_URLS.publish,
            Authorization: ''
          }
        )

        const permit = this.readXhsUploadPermit(response.data)
        if (response.status >= 200 && response.status < 300 && this.isValidXhsUploadPermit(permit)) {
          logger.info(`[xiaohongshu] ${scene} upload permit via ${endpoint.name}: host=${permit.uploadAddr}, fileId=${permit.fileIds[0]}`)
          return permit
        }

        const body = this.summarizeXhsPayload(response.data)
        failures.push(`${endpoint.name}=HTTP ${response.status}${body ? ` ${body}` : ''}`)
        logger.warn(`[xiaohongshu] ${scene} upload permit via ${endpoint.name} failed: HTTP ${response.status}${body ? `, body=${body}` : ''}`)
      } catch (err: any) {
        const detail = err?.message || String(err)
        failures.push(`${endpoint.name}=error ${detail}`)
        logger.warn(`[xiaohongshu] ${scene} upload permit via ${endpoint.name} error: ${detail}`)
      }
    }

    const label = scene === 'image' ? '封面上传凭证' : '上传凭证'
    throw new Error(`获取${label}失败: ${failures.join(' | ')}`)
  }

  private readXhsUploadPermit(data: XhsUploadPermitResponse | undefined): XhsUploadPermit | undefined {
    if (!data || typeof data !== 'object') return undefined
    if (data.data && typeof data.data === 'object' && Array.isArray(data.data.uploadTempPermits)) {
      return data.data.uploadTempPermits[0]
    }
    if (Array.isArray(data.uploadTempPermits)) {
      return data.uploadTempPermits[0]
    }
    return undefined
  }

  private isValidXhsUploadPermit(permit: XhsUploadPermit | undefined): permit is XhsValidUploadPermit {
    return !!permit?.uploadAddr && Array.isArray(permit.fileIds) && permit.fileIds.length > 0 && !!permit.fileIds[0]
  }

  private summarizeXhsPayload(data: unknown, maxLength = 300): string {
    if (data === undefined || data === null) return ''
    if (typeof data === 'string') return data.substring(0, maxLength)
    try {
      return JSON.stringify(data).substring(0, maxLength)
    } catch {
      return String(data).substring(0, maxLength)
    }
  }

  /**
   * Upload cover image to Xiaohongshu via Tencent COS.
   * Uses the same permit API as video but with scene=image.
   * Reference: yixiaoer uploadCoverProcess$6 / uploadImage$8
   */
  async uploadCoverImageAPI(
    client: HttpClient,
    imagePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<string> {
    if (!existsSync(imagePath)) {
      throw new Error(`封面图片不存在: ${imagePath}`)
    }

    onProgress?.({ percent: 85, stage: '正在上传封面...' })

    // Step 1: Get upload permit for image (scene=image)
    const permit = await this.getXhsUploadPermit(client, 'image')

    const fileId = permit.fileIds[0]
    const uploadAddr = permit.uploadAddr
    const token = permit.token || ''

    logger.info(`[xiaohongshu] Cover upload permit: host=${uploadAddr}, fileId=${fileId}`)

    // Step 2: PUT image to COS (matching yixiaoer's uploadImage$8)
    const imageBuffer = readFileSync(imagePath)
    const uploadUrl = `https://${uploadAddr}/${fileId}`

    await client.request({
      method: 'PUT',
      url: uploadUrl,
      data: imageBuffer,
      headers: {
        'x-cos-security-token': token,
        referer: 'https://creator.xiaohongshu.com/',
        Origin: 'https://creator.xiaohongshu.com',
        Authorization: '',
        'Content-Type': ''
      },
      noCookie: true,
      timeout: 60_000,
      responseType: 'text'
    })

    logger.info(`[xiaohongshu] Cover image uploaded, fileId: ${fileId}`)
    onProgress?.({ percent: 90, stage: '封面上传完成' })

    return fileId
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string, coverFileId?: string): Promise<SubmitResult> {
    // XiaoHongShuStatementType enum (from yixiaoer)
    const XiaoHongShuStatementType = {
      ONLY_FOR_FUN: 1,  // 虚构演绎，仅供娱乐
      AIGC: 2,          // 笔记含AI合成内容
      MARK: 3,          // 内容包含营销广告
      OWN: 4,           // 自主拍摄
      FORWARD: 5        // 来源转载
    }

    // Build business_binds object (matching yixiaoer's structure)
    const businessBinds: Record<string, unknown> = {
      version: 1,
      noteId: 0,
      bizType: 0,
      noteOrderBind: {},
      groupBind: {},
      liveNoticeBind: {},
      notePostTiming: {},
      noteCollectionBind: { id: '' },
      optionRelationList: []
    }

    // Add collection if provided (through noteCollectionBind)
    if (payload.platformFields?.collection) {
      businessBinds.noteCollectionBind = { id: payload.platformFields.collection }
      logger.info(`[xiaohongshu] Added collection: ${payload.platformFields.collection}`)
    }

    // Add original declaration if provided (through optionRelationList)
    if (payload.platformFields?.originalDeclaration) {
      (businessBinds.optionRelationList as Array<Record<string, unknown>>).push({
        type: 'ORIGINAL_STATEMENT',
        relationList: [{
          bizType: 'ORIGINAL_STATEMENT',
          bizId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          extraInfo: '{}'
        }]
      })
      logger.info(`[xiaohongshu] Added original declaration`)
    }

    // Build description with embedded topics (matching yixiaoer format: #topicName[话题]#)
    let descText = payload.description || ''
    if (payload.hashtags.length > 0) {
      const topicSuffix = payload.hashtags.map((tag) => ` #${tag}[话题]# `).join('')
      descText = descText + topicSuffix
    }

    // Build common object
    const commonObj: Record<string, unknown> = {
      type: 'video',
      title: payload.title || '',
      note_id: '',
      desc: descText,
      source: JSON.stringify({ type: 'web', ids: '', extraInfo: JSON.stringify({ systemId: 'web' }) }),
      business_binds: JSON.stringify(businessBinds),
      ats: [],
      biz_relations: [],
      hash_tag: payload.hashtags.map((tag) => ({
        id: '',
        name: tag,
        link: '',
        type: 'topic'
      })),
      privacy_info: { op_type: 1, type: 0, user_ids: [] },
      capa_trace_info: {
        contextJson: JSON.stringify({
          recommend_title: { recommend_title_id: '', is_use: false, used_index: -1 },
          recommendTitle: [],
          recommend_topics: { used: [] }
        })
      }
    }

    // Add location if provided (through post_loc)
    // Format matching yixiaoer: { poi_id, name, poi_type, subname }
    // yixiaoer: K={poi_id:$.location.poiOid, name:$.location.name, poi_type:$.location.source, subname:$.location.subname}
    if (payload.platformFields?.location) {
      const loc = payload.platformFields.location
      if (typeof loc === 'object' && loc !== null && 'name' in loc) {
        const locObj = loc as { name: string; poi_id?: string; address?: string; extra?: Record<string, unknown> }
        commonObj.post_loc = {
          poi_id: locObj.poi_id || '',
          name: locObj.name,
          poi_type: (locObj.extra?.poi_type as number) || 0,
          subname: locObj.address || ''
        }
        logger.info(`[xiaohongshu] Location: poi_id=${commonObj.post_loc.poi_id}, name=${locObj.name}, subname=${commonObj.post_loc.subname}`)
      } else if (typeof loc === 'string') {
        commonObj.post_loc = { poi_id: '', name: loc, subname: '' }
      }
    } else {
      logger.info(`[xiaohongshu] No location provided, platformFields.location=${JSON.stringify(payload.platformFields?.location)}`)
    }

    logger.info(`[xiaohongshu] post_loc=${JSON.stringify(commonObj.post_loc)}, desc (first 200)=${descText.substring(0, 200)}, hash_tag count=${payload.hashtags.length}`)

    // Add content type declaration if provided (through userDeclarationBind)
    const contentTypeDeclarations = payload.platformFields?.contentTypeDeclaration as string[] || []
    if (contentTypeDeclarations.length > 0) {
      const decl = contentTypeDeclarations[0] // Only one can be selected
      let statementType: number | null = null

      switch (decl) {
        case '虚构演绎':
          statementType = XiaoHongShuStatementType.ONLY_FOR_FUN
          break
        case 'AI合成':
          statementType = XiaoHongShuStatementType.AIGC
          break
        case '营销广告':
          statementType = XiaoHongShuStatementType.MARK
          break
        case '自主拍摄':
          statementType = XiaoHongShuStatementType.OWN
          break
        case '来源转载':
          statementType = XiaoHongShuStatementType.FORWARD
          break
      }

      if (statementType !== null) {
        // userDeclarationBind is added to business_binds as a JSON string
        const userDeclarationBind: Record<string, unknown> = { origin: statementType }

        // For FORWARD type, add repostInfo
        if (statementType === XiaoHongShuStatementType.FORWARD && payload.platformFields?.forwardSource) {
          userDeclarationBind.repostInfo = { source: payload.platformFields.forwardSource }
        }

        // For OWN type, add photoInfo if available
        if (statementType === XiaoHongShuStatementType.OWN && payload.platformFields?.photoInfo) {
          userDeclarationBind.photoInfo = payload.platformFields.photoInfo
        }

        // Add to business_binds as a separate field in the JSON string
        const bindsStr = commonObj.business_binds as string
        const binds = JSON.parse(bindsStr)
        binds.userDeclarationBind = userDeclarationBind
        commonObj.business_binds = JSON.stringify(binds)

        logger.info(`[xiaohongshu] Added content type declaration: ${decl} (type: ${statementType})`)
      }
    }

    // Use actual video metadata if available, otherwise use defaults (matching yixiaoer)
    const meta = payload.videoMetadata
    const vidWidth = meta?.width || 720
    const vidHeight = meta?.height || 1280
    const vidDuration = meta?.duration || 0
    const vidFps = meta?.fps || 30
    const vidBitrate = meta?.bitrate || 0

    const originalMetadata = {
      video: {
        bitrate: vidBitrate,
        duration: vidDuration,
        frame_rate: vidFps,
        height: vidHeight,
        width: vidWidth
      },
      audio: { bitrate: 0, channels: 1, duration: vidDuration, format: 'AAC', sampling_rate: 0 }
    }

    let uploadMeta: Record<string, unknown> | null = null
    if (payload.recordId) {
      uploadMeta = getPublishRecordRepository().getUploadMeta(payload.recordId)
    }
    const firstFrameFileId = uploadMeta
      ? this.readStringField(uploadMeta, ['firstFrameFileId', 'first_frame_file_id'])
      : undefined
    const uploadedFileId = uploadMeta
      ? this.readStringField(uploadMeta, ['fileId', 'file_id'])
      : undefined
    const xhsVideoId = uploadMeta
      ? this.readStringField(uploadMeta, ['xhsVideoId', 'xhs_video_id'])
      : undefined
    const effectiveCoverFileId = coverFileId || firstFrameFileId || ''
    if (uploadMeta) {
      logger.info(
        `[xiaohongshu] Upload meta: fileId=${uploadedFileId || 'none'}, ` +
        `xhsVideoId=${xhsVideoId || 'none'}, firstFrameFileId=${firstFrameFileId || 'none'}`
      )
    }

    // Build cover object (matching current creator frontend structure after toSnakeCase)
    const coverObj: Record<string, unknown> = {
      height: vidHeight,
      file_id: effectiveCoverFileId,
      fileid: effectiveCoverFileId,
      width: vidWidth,
      frame: { ts: 0, is_user_select: !!coverFileId, is_upload: !!coverFileId }
    }

    // Build body
    const body: Record<string, unknown> = {
      common: commonObj,
      image_info: null,
      video_info: {
        file_id: videoId || '',
        fileid: videoId || '',
        format_width: vidWidth,
        format_height: vidHeight,
        composite_metadata: {
          video: {
            bitrate: vidBitrate,
            colour_primaries: 'BT.709',
            duration: vidDuration,
            format: 'AVC',
            frame_rate: vidFps,
            height: vidHeight,
            matrix_coefficients: 'BT.709',
            rotation: 0,
            transfer_characteristics: 'BT.709',
            width: vidWidth
          },
          audio: { bitrate: 0, channels: 1, duration: vidDuration, format: 'AAC', sampling_rate: 0 }
        },
        timelines: [],
        cover: coverObj,
        chapters: [],
        chapter_sync_text: false,
        segments: {
          count: 1,
          need_slice: false,
          items: [{
            mute: 0,
            speed: 1,
            start: 0,
            duration: vidDuration,
            transcoded: 0,
            media_source: 1,
            original_metadata: originalMetadata
          }]
        },
        entrance: 'web'
      }
    }

    try {
      let cookie = client.getCookieString()
      const bodyStr = JSON.stringify(body)
      const urlPath = '/web_api/sns/v2/note'
      const browserResult = await this.submitXhsViaBuiltinBrowser(
        cookie,
        urlPath,
        bodyStr,
        { 'Content-Type': 'application/json;charset=UTF-8' },
        client.getAccountId()
      )
      if (browserResult) return browserResult

      logger.warn('[xiaohongshu] Built-in browser submit unavailable, falling back to signed HTTP submit')
      const { headers: signHeaders, a1 } = await this.getXhsSignHeaders(
        urlPath,
        cookie,
        bodyStr,
        client.getAccountId()
      )

      // Replace a1 cookie if signing returned a new one (matching yixiaoer)
      if (a1) {
        cookie = cookie.replace('a1=', 'a1old=')
        cookie = `${cookie};a1=${a1}`
      }

      const extraSignHeaders = Object.keys(signHeaders)
        .filter((name) => {
          const lower = name.toLowerCase()
          return lower.startsWith('x-') && lower !== 'x-s' && lower !== 'x-t' && lower !== 'x-s-common'
        })
      const hasRapParam = extraSignHeaders.some((name) => name.toLowerCase() === 'x-rap-param')
      logger.info(`[xiaohongshu] Submit headers: X-s=${signHeaders['X-s'] ? 'yes' : 'no'}, X-t=${signHeaders['X-t'] ? 'yes' : 'no'}, X-S-Common=${signHeaders['X-S-Common'] ? 'yes' : 'no'}, x-rap-param=${hasRapParam ? 'yes' : 'no'}, extra=${extraSignHeaders.join(',') || 'none'}, a1_replaced=${!!a1}`)
      logger.info(`[xiaohongshu] Submit common.desc (first 300)=${(commonObj.desc as string)?.substring(0, 300)}`)
      logger.info(`[xiaohongshu] Submit common.post_loc=${JSON.stringify(commonObj.post_loc)}`)
      logger.info(`[xiaohongshu] Submit common.hash_tag=${JSON.stringify(commonObj.hash_tag)}`)

      if (!signHeaders['X-S-Common'] && !hasRapParam) {
        throw new Error(
          '内容提交失败: 小红书签名不完整，缺少 X-S-Common / x-rap-param。' +
          '当前 signer 未生成创作者发布接口需要的完整网页签名，通常会返回 HTTP 406。' +
          '请启动能返回完整签名的本机 signer，或重新登录小红书并确认创作者中心完整加载后重试。'
        )
      }

      // Use axios directly with the same authenticated web session and creator-page headers.
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
            referer: XHS_URLS.publish,
            Origin: 'https://creator.xiaohongshu.com',
            Authorization: '',
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14',
            Accept: 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip,deflate,br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
            'sec-ch-ua': '"Microsoft Edge";v="136", "Chromium";v="136", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'Sec-Fetch-Site': 'same-site',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            ...signHeaders
          },
          timeout: 30_000,
          responseType: 'json'
        }
      )

      logger.info(`[xiaohongshu] Submit response: ${JSON.stringify(response.data).substring(0, 500)}`)

      const submitResult = this.parseXhsSubmitSuccess(response.data, 'signed HTTP')
      if (submitResult) return submitResult

      if (this.isXhsSubmitAccepted(response.data)) {
        throw this.createXhsUnconfirmedSubmitError('signed HTTP', response.status, response.data)
      }

      if (!response.data.success) {
        throw new Error(`内容提交失败: ${response.data.msg || JSON.stringify(response.data).substring(0, 200)}`)
      }
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        const data = err.response?.data
        logger.error(`[xiaohongshu] Submit HTTP error: ${status}`, JSON.stringify(data).substring(0, 500))
        const submitResult = this.parseXhsSubmitSuccess(data, `HTTP ${status}`)
        if (submitResult) return submitResult

        const parsedData = this.parseXhsSubmitPayload(data)
        if (this.isXhsSubmitAccepted(parsedData)) {
          throw this.createXhsUnconfirmedSubmitError(`HTTP ${status}`, status, parsedData)
        }

        if (status === 406 || status === 403) {
          const cookie = client.getCookieString()
          const bodyStr = JSON.stringify(body)
          const urlPath = '/web_api/sns/v2/note'
          const fallbackHeaders = await this.getXhsSignHeaders(
            urlPath,
            cookie,
            bodyStr,
            client.getAccountId()
          ).then((result) => result.headers)
          const fallbackHasRapParam = Object.keys(fallbackHeaders)
            .some((name) => name.toLowerCase() === 'x-rap-param')
          if (!fallbackHeaders['X-S-Common'] && !fallbackHasRapParam) {
            throw new Error(
              '内容提交失败: 小红书签名不完整，缺少 X-S-Common / x-rap-param。' +
              '请启动能返回完整网页签名的本机 signer 后重试。'
            )
          }
          const browserResult = await this.submitXhsViaBuiltinBrowser(
            cookie,
            urlPath,
            bodyStr,
            fallbackHeaders,
            client.getAccountId()
          )
          if (browserResult) return browserResult
        }
        throw new Error(`内容提交失败: HTTP ${status} ${JSON.stringify(data).substring(0, 200)}`)
      }
      logger.error('[xiaohongshu] submitContentAPI error:', err)
      throw err
    }
  }

  private async submitXhsViaBuiltinBrowser(
    cookie: string,
    urlPath: string,
    bodyStr: string,
    signHeaders: Record<string, string>,
    accountId?: string
  ): Promise<SubmitResult | null> {
    logger.info('[xiaohongshu] Trying built-in browser submit for note create')
    const response = await getSignService().postXhsInBuiltinBrowser(cookie, urlPath, bodyStr, signHeaders, accountId)
    if (!response) return null

    logger.info(`[xiaohongshu] Built-in browser submit response: status=${response.status}, body=${response.text.substring(0, 500)}`)

    let data: XhsSubmitResponse | null = null
    try {
      data = this.parseXhsSubmitPayload(response.text)
    } catch {
      data = null
    }

    const submitResult = this.parseXhsSubmitSuccess(data, `built-in browser HTTP ${response.status}`)
    if (submitResult) return submitResult

    if (this.isXhsSubmitAccepted(data)) {
      throw this.createXhsUnconfirmedSubmitError(`built-in browser HTTP ${response.status}`, response.status, data)
    }

    if (response.status === 403 || response.status === 406) {
      const signKeys = (response.signKeys?.length
        ? response.signKeys
        : Object.keys(signHeaders).filter((name) => name.toLowerCase().startsWith('x-')))
        .join(',') || 'none'
      logger.warn(
        `[xiaohongshu] Built-in browser submit rejected: HTTP ${response.status}, ` +
        `signKeys=${signKeys}, X-S-Common=${response.hasXSCommon ? 'yes' : 'no'}, ` +
        `x-rap-param=${response.hasRapParam ? 'yes' : 'no'}, ` +
        `_webmsxyw=${response.hasWebmsxyw ? 'yes' : 'no'}, ` +
        `signedKeys=${response.signedKeys?.join(',') || 'none'}, pageUrl=${response.pageUrl || 'unknown'}`
      )
      return null
    }

    if (response.status < 200 || response.status >= 300) {
      return null
    }

    if (!data) {
      logger.warn(`[xiaohongshu] Built-in browser submit returned non-JSON: ${response.text.substring(0, 300)}`)
      throw new Error(`内容提交失败: 小红书浏览器提交返回非 JSON 响应（HTTP ${response.status}）`)
    }

    if (!data.success) {
      throw new Error(`内容提交失败: ${data.msg || JSON.stringify(data).substring(0, 300)}`)
    }

    return null
  }

  private parseXhsSubmitPayload(raw: unknown): XhsSubmitResponse | null {
    let payload = raw
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload) as unknown
      } catch {
        return null
      }
    }
    if (!payload || typeof payload !== 'object') return null
    return payload as XhsSubmitResponse
  }

  private extractXhsDataObject(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object') return {}
    const obj = raw as Record<string, unknown>
    const data = obj.data
    if (data && typeof data === 'object') return data as Record<string, unknown>
    return obj
  }

  private readStringField(obj: Record<string, unknown>, paths: string[]): string | undefined {
    for (const path of paths) {
      const value = this.readNestedField(obj, path)
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim()
        if (text) return text
      }
    }
    return undefined
  }

  private readBooleanField(obj: Record<string, unknown>, paths: string[]): boolean {
    for (const path of paths) {
      const value = this.readNestedField(obj, path)
      if (value === true || value === 'true' || value === 1 || value === '1') return true
      if (value === false || value === 'false' || value === 0 || value === '0') return false
    }
    return false
  }

  private readNestedField(obj: Record<string, unknown>, path: string): unknown {
    let current: unknown = obj
    for (const key of path.split('.')) {
      if (!current || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[key]
    }
    return current
  }

  private parseXhsSubmitSuccess(raw: unknown, source: string): SubmitResult | null {
    const data = this.parseXhsSubmitPayload(raw)
    if (!data) return null

    if (!this.isXhsSubmitAccepted(data)) return null

    const noteId = this.extractXhsNoteId(data)
    if (!noteId) {
      logger.warn(`[xiaohongshu] Submit acknowledged via ${source}, but note_id is missing; response=${JSON.stringify(data).substring(0, 500)}`)
      return null
    }

    logger.info(`[xiaohongshu] Content submitted via ${source}, note_id: ${noteId || 'none'}`)

    return {
      contentId: noteId,
      publishUrl: noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : undefined
    }
  }

  private isXhsSubmitAccepted(data: XhsSubmitResponse | null): boolean {
    return !!data && (data.success === true || (data.code === 0 && data.success !== false))
  }

  private extractXhsNoteId(data: XhsSubmitResponse): string | undefined {
    const noteIdValue = data.data?.note_id || data.data?.noteId || data.data?.id
    if (typeof noteIdValue === 'string' || typeof noteIdValue === 'number') {
      const noteId = String(noteIdValue).trim()
      return noteId || undefined
    }
    return undefined
  }

  private createXhsUnconfirmedSubmitError(source: string, status?: number, data?: XhsSubmitResponse | null): Error {
    const statusPart = typeof status === 'number' ? `HTTP ${status}` : source
    const msgPart = data?.msg ? `，平台消息：${data.msg}` : ''
    return new Error(
      `内容提交状态无法确认: 小红书${source}返回成功标记但没有 note_id（${statusPart}）${msgPart}。` +
      '已停止将该记录标记为成功，避免误报。请到小红书创作者中心的发布管理、审核中或草稿箱确认该视频是否已生成笔记。'
    )
  }

  /**
   * 获取笔记列表（含统计数据）
   * 使用小红书创作者笔记列表 API (参考蚁小二)
   * GET https://edith.xiaohongshu.com/web_api/sns/v5/creator/note/user/posted?tab=0&page=${page}
   * 需要 X-s 和 X-t 签名 headers
   */
  async getVideoList(client: HttpClient, options?: { cursor?: string; pageSize?: number }): Promise<VideoListResult> {
    const page = options?.cursor || '0'
    const urlPath = `/web_api/sns/v5/creator/note/user/posted?tab=0&page=${page}`

    const cookie = client.getCookieString()

    // 获取签名 headers (参考蚁小二的 getSign$6)
    const { headers: signHeaders } = await this.getXhsSignHeaders(urlPath, cookie, undefined, client.getAccountId())

    const response = await axios.get<{
      code: number
      success: boolean
      msg: string
      data: {
        notes: Array<{
          id: string
          display_title: string
          title?: string
          type: string
          view_count: number
          likes: number
          comments_count: number
          shared_count: number
          collected_count: number
          images_list?: Array<{ url: string }>
          time?: string
          sticky?: boolean
        }>
        has_more?: boolean
      }
    }>(
      `https://edith.xiaohongshu.com${urlPath}`,
      {
        headers: {
          cookie,
          referer: XHS_URLS.publish,
          Origin: 'https://creator.xiaohongshu.com/',
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14',
          ...signHeaders
        },
        timeout: 30_000,
        responseType: 'json'
      }
    )

    logger.info(`[xiaohongshu] getVideoList response: success=${response.data.success}, notes count=${response.data.data?.notes?.length || 0}`)

    if (!response.data.success) {
      throw new Error(`获取笔记列表失败: ${response.data.msg}`)
    }

    const noteInfos = response.data.data?.notes || []

    const items = noteInfos.map((note) => ({
      contentId: note.id,
      title: note.display_title || note.title || '',
      coverUrl: note.images_list?.[0]?.url,
      publishTime: 0, // API 不返回时间戳
      views: note.view_count || 0,
      likes: note.likes || 0,
      comments: note.comments_count || 0,
      shares: note.shared_count || 0,
      favorites: note.collected_count || 0
    }))

    return {
      items,
      cursor: String(Number(page) + 1),
      hasMore: response.data.data?.has_more || false
    }
  }

  /**
   * Generate XHS request signature headers.
   *
   * Uses the unified SignService so Xiaohongshu follows the same self-hosted
   * signer path as the other platforms.
   */
  private async getXhsSignHeaders(
    urlPath: string,
    cookie: string,
    body?: string,
    accountId?: string
  ): Promise<{ headers: Record<string, string>; a1?: string }> {
    const signService = getSignService()
    const signature = await signService.getSignature(
      'xiaohongshu',
      cookie,
      JSON.stringify({ url: urlPath, body: body || '' }),
      body,
      accountId
    )
    if (!signature) {
      throw new Error('小红书签名服务未返回签名')
    }
    const parsed = JSON.parse(signature.replace(/\\/g, '"')) as Record<string, string | undefined>
    const xs = parsed['X-s'] || parsed['x-s']
    const xt = parsed['X-t'] || parsed['x-t']
    const rapParamEntry = Object.entries(parsed)
      .find(([name, value]) => name.toLowerCase() === 'x-rap-param' && !!value)

    if ((!xs || !xt) && !rapParamEntry) {
      throw new Error('小红书签名服务未返回有效的 X-s / X-t 或 x-rap-param')
    }

    const headers: Record<string, string> = {}
    if (xs && xt) {
      headers['X-s'] = xs
      headers['X-t'] = String(xt)
    }
    if (parsed['X-S-Common']) {
      headers['X-S-Common'] = parsed['X-S-Common']
    }
    for (const [name, value] of Object.entries(parsed)) {
      const lowerName = name.toLowerCase()
      if (!value || !lowerName.startsWith('x-')) continue
      if (lowerName === 'x-s' || lowerName === 'x-t' || lowerName === 'x-s-common') continue
      headers[name] = value
    }

    const extraHeaders = Object.keys(headers)
      .filter((name) => {
        const lowerName = name.toLowerCase()
        return lowerName.startsWith('x-') && lowerName !== 'x-s' && lowerName !== 'x-t' && lowerName !== 'x-s-common'
      })
    logger.info(`[xiaohongshu] Sign headers from unified signer, X-S-Common: ${parsed['X-S-Common'] ? 'yes' : 'no'}, x-rap-param=${rapParamEntry ? 'yes' : 'no'}, extra=${extraHeaders.join(',') || 'none'}, has a1: ${!!parsed.a1}`)
    return { headers, a1: parsed.a1 }
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

  /**
   * Get recommended POI locations on Xiaohongshu.
   * Uses the v1 API without keyword to get nearby recommendations.
   * Reference: yixiaoer implementation
   */
  async getRecommendLocations(client: HttpClient, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()

      logger.info(`[xiaohongshu] getRecommendLocations called with options:`, options)

      // Use actual lat/lng for nearby results (yixiaoer uses 0 but their API context differs)
      const body = {
        latitude: options?.lat || 0,
        longitude: options?.lng || 0,
        keyword: '',
        page: 1,
        size: options?.count || 30,
        source: 'WEB',
        type: 3
      }

      logger.info(`[xiaohongshu] POI recommend request body:`, body)

      const response = await axios.post<{
        success: boolean
        data?: {
          poi_list?: Array<{
            poi_id?: string
            poi_name?: string
            full_address?: string
            latitude?: number
            longitude?: number
            city?: string
            poi_type?: number
          }>
        }
        msg?: string
      }>(
        API.locationSearch,
        body,
        {
          headers: {
            cookie,
            referer: 'https://creator.xiaohongshu.com/',
            Authorization: '',
            Origin: 'https://creator.xiaohongshu.com',
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'
          },
          timeout: 15_000,
          responseType: 'json'
        }
      )

      logger.info(`[xiaohongshu] POI recommend response:`, {
        success: response.data.success,
        hasData: !!response.data.data,
        hasPoiList: !!response.data.data?.poi_list,
        poiCount: response.data.data?.poi_list?.length || 0,
        msg: response.data.msg
      })

      if (!response.data.success || !response.data.data?.poi_list) {
        logger.warn(`[xiaohongshu] POI recommend failed: ${response.data.msg}`)
        return []
      }

      // Log first item to debug field names
      const firstItem = response.data.data.poi_list[0]
      if (firstItem) {
        logger.info(`[xiaohongshu] First POI item fields:`, JSON.stringify(firstItem).substring(0, 500))
      }

      const results: import('../IPlatformAdapter').LocationResult[] = response.data.data.poi_list.map((item) => ({
        id: item.poi_id || '',
        name: item.poi_name || item.name || '',
        address: item.full_address || item.city || '',
        lat: item.latitude,
        lng: item.longitude,
        poi_id: item.poi_id,
        extra: { city: item.city, poi_type: item.poi_type }
      }))

      return results
    } catch (err) {
      logger.error('[xiaohongshu] getRecommendLocations error:', err)
      return []
    }
  }

  /**
   * Search POI locations on Xiaohongshu.
   * Uses the v1 API with keyword, no signature required.
   * Reference: yixiaoer implementation
   */
  async searchLocation(client: HttpClient, keyword: string, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()

      logger.info(`[xiaohongshu] searchLocation called with keyword: ${keyword}, options:`, options)

      // 使用和 yixiaoer 相同的实现方式，不使用签名
      const body = {
        latitude: options?.lat || 0,
        longitude: options?.lng || 0,
        keyword,
        page: 1,
        size: options?.count || 30,
        source: 'WEB',
        type: 3
      }

      logger.info(`[xiaohongshu] POI search request body:`, body)

      const response = await axios.post<{
        success: boolean
        data?: {
          poi_list?: Array<{
            poi_id?: string
            poi_name?: string
            full_address?: string
            latitude?: number
            longitude?: number
            city?: string
            poi_type?: number
          }>
        }
        msg?: string
      }>(
        API.locationSearch,
        body,
        {
          headers: {
            cookie,
            referer: 'https://creator.xiaohongshu.com/',
            Authorization: '',
            Origin: 'https://creator.xiaohongshu.com',
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'
          },
          timeout: 15_000,
          responseType: 'json'
        }
      )

      logger.info(`[xiaohongshu] POI search response:`, {
        success: response.data.success,
        hasData: !!response.data.data,
        hasPoiList: !!response.data.data?.poi_list,
        poiCount: response.data.data?.poi_list?.length || 0,
        msg: response.data.msg
      })

      if (!response.data.success || !response.data.data?.poi_list) {
        logger.warn(`[xiaohongshu] POI search failed: ${response.data.msg}`)
        return []
      }

      // Log first search result to debug field names
      const firstItem = response.data.data.poi_list[0]
      if (firstItem) {
        logger.info(`[xiaohongshu] First search POI fields:`, JSON.stringify(firstItem).substring(0, 500))
      }

      return response.data.data.poi_list.map((item) => ({
        id: item.poi_id || '',
        name: item.poi_name || item.name || '',
        address: item.full_address || item.address || item.city || '',
        lat: item.latitude,
        lng: item.longitude,
        poi_id: item.poi_id,
        extra: { city: item.city_name || item.city, poi_type: item.poi_type }
      }))
    } catch (err) {
      logger.error('[xiaohongshu] searchLocation error:', err)
      return []
    }
  }
}
