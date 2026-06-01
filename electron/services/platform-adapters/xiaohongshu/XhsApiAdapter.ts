import type { BrowserContext, Page } from 'playwright-core'
import axios from 'axios'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import { HttpClient } from '../../http/HttpClient'
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
  personalInfo: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info',
  collectionList: 'https://edith.xiaohongshu.com/api/sns/v1/note/collection/pc/list_v2',
  locationSearch: 'https://edith.xiaohongshu.com/web_api/sns/v1/local/poi/creator/search',
  locationSearchV5: 'https://www.xiaohongshu.com/web_api/sns/v5/creator/poi/search'
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
          { label: '内容包含营销广告', value: '营销广告' },
          { label: '自主拍摄', value: '自主拍摄' },
          { label: '来源转载', value: '来源转载' }
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
          referer: 'https://creator.xiaohongshu.com/publish/publish',
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
      let cookie = client.getCookieString()
      logger.info(`[xiaohongshu] getCollections called, cookie length: ${cookie.length}`)

      const urlPath = '/api/sns/v1/note/collection/pc/list_v2'
      const bodyStr = JSON.stringify({ cursor: '', need_type_list: [0], target_uid: '' })

      logger.info(`[xiaohongshu] Getting sign headers for collection list...`)
      const { headers: signHeaders, a1 } = await this.getXhsSignHeaders(urlPath, cookie, bodyStr)
      logger.info(`[xiaohongshu] Sign headers: X-s=${signHeaders['X-s'] ? 'yes' : 'no'}, X-t=${signHeaders['X-t'] ? 'yes' : 'no'}, X-S-Common=${signHeaders['X-S-Common'] ? 'yes' : 'no'}, has a1: ${!!a1}`)

      if (a1) {
        cookie = cookie.replace('a1=', 'a1old=')
        cookie = `${cookie};a1=${a1}`
      }

      logger.info(`[xiaohongshu] POST ${API.collectionList}, body=${bodyStr}`)

      // 使用 HttpClient 发送请求（和发布接口保持一致的 headers）
      const apiClient = new HttpClient({ cookies: cookie, platform: 'xiaohongshu', accountId: '' })
      const response = await apiClient.post<{
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
      }>(
        API.collectionList,
        { cursor: '', need_type_list: [0], target_uid: '' },
        {
          Origin: 'https://creator.xiaohongshu.com',
          referer: 'https://creator.xiaohongshu.com',
          Authorization: '',
          ...signHeaders
        }
      )

      logger.info(`[xiaohongshu] Collections response: result=${response.data.result}, msg=${response.data.msg}, hasData=${!!response.data.data}, hasList=${!!response.data.data?.collection_info_list}`)

      if (response.data.result !== 0 || !response.data.data?.collection_info_list) {
        logger.warn(`[xiaohongshu] Collections fetch failed: ${response.data.msg}`)
        return []
      }

      return response.data.data.collection_info_list
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

    // Step 2b: Upload parts with concurrency (8MB each, 3 concurrent — matching yixiaoer)
    const PART_SIZE = 8 * 1024 * 1024 // 8MB — matching yixiaoer's chunk size
    const totalParts = Math.ceil(stats.size / PART_SIZE)
    const etags: string[] = new Array(totalParts)
    const CONCURRENCY = 3
    let completedParts = 0

    const uploadPart = async (i: number, maxRetries = 3) => {
      const start = i * PART_SIZE
      const end = Math.min(start + PART_SIZE, stats.size)
      const part = fileBuffer.subarray(start, end)
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

          // Strip quotes from etag if present
          let etag = partResponse.headers?.etag || partResponse.data?.ETag || ''
          etag = etag.replace(/^"|"$/g, '')
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

    // Build common object
    const commonObj: Record<string, unknown> = {
      type: 'video',
      title: payload.title || '',
      note_id: '',
      desc: payload.description || '',
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
      privacy_info: { op_type: 1, type: 0 }
    }

    // Add location if provided (through post_loc)
    if (payload.platformFields?.location) {
      const loc = payload.platformFields.location
      if (typeof loc === 'object' && loc !== null && 'name' in loc) {
        const locObj = loc as { name: string; poi_id?: string; lat?: number; lng?: number }
        commonObj.post_loc = {
          poi_id: locObj.poi_id || '',
          name: locObj.name,
          ...(locObj.lat ? { latitude: locObj.lat } : {}),
          ...(locObj.lng ? { longitude: locObj.lng } : {})
        }
      } else if (typeof loc === 'string') {
        commonObj.post_loc = { poi_id: '', name: loc }
      }
    }

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

    // Build body
    const body: Record<string, unknown> = {
      common: commonObj,
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

      // Use axios directly with realistic 2026 browser headers
      // 所有版本号必须与最新真实浏览器一致，避免被检测为自动化工具
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
            referer: 'https://creator.xiaohongshu.com/publish/publish',
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
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
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

      // Add city-level option as first result if not already present
      if (options?.city && !results.some(r => r.name === options.city || r.name === options.city + '市')) {
        results.unshift({
          id: `city_${options.city}`,
          name: options.city,
          address: options.city,
          lat: options.lat,
          lng: options.lng,
          poi_id: `city_${options.city}`,
          extra: { city: options.city, isCityLevel: true }
        })
      }

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
