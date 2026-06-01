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
import { existsSync, statSync, createReadStream, readFileSync } from 'fs'
import { createHash, createPrivateKey, createSign, randomBytes, createHmac } from 'crypto'
import aws4 from 'aws4'

// Douyin Creator API endpoints (reverse-engineered from yixiaoer)
const API = {
  userInfo: 'https://creator.douyin.com/aweme/v1/creator/user/info/',
  pcUserInfo: 'https://creator.douyin.com/aweme/v1/creator/pc/user/info/',
  csrfToken: 'https://creator.douyin.com/web/api/media/aweme/create/',
  uploadAuth: 'https://creator.douyin.com/web/api/media/upload/auth/v5/',
  awemeCreate: 'https://creator.douyin.com/web/api/media/aweme/create_v2/',
  collections: 'https://creator.douyin.com/aweme/v1/collection/list/',
  poiRecommend: 'https://creator.douyin.com/aweme/v1/poi/recommend/',
  poiSearch: 'https://creator.douyin.com/aweme/v1/life/video_api/search/poi/',
  vodCommit: 'https://vod.bytedanceapi.com'
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
  browser_version: '5.0+(Windows+NT+10.0;+Win64;+x64)+AppleWebKit/537.36+(KHTML,+like+Gecko)+Chrome/140.0.0.0+Safari/537.36',
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
      { name: 'collection', type: 'dynamic-select', label: '合集', placeholder: '选择合集', dynamicKey: 'collections' },
      { name: 'poiLocation', type: 'location', label: '位置', placeholder: '搜索地点' },
      {
        name: 'declarations',
        type: 'checkbox-group',
        label: '内容声明',
        maxSelections: 1,
        options: [
          { label: '原创声明', value: '原创声明' },
          { label: '转载声明', value: '转载声明' },
          { label: '内容由 AI 生成', value: 'AI生成' },
          { label: '可能引起不适', value: '可能引起不适' },
          { label: '虚构演绎，仅供娱乐', value: '虚构演绎' },
          { label: '危险行为，请勿模仿', value: '危险行为' }
        ]
      },
      {
        name: 'downloadPermission',
        type: 'checkbox-group',
        label: '保存权限',
        options: [
          { label: '允许下载', value: 'allow' },
          { label: '不允许下载', value: 'deny' }
        ],
        maxSelections: 1
      }
    ]
  }

  /**
   * Fetch user's collection list from Douyin creator API.
   */
  async getCollections(client: HttpClient): Promise<Array<{ label: string; value: string }>> {
    try {
      const cookie = client.getCookieString()
      const csrfToken = await this.getCsrfToken(client)

      const params = new URLSearchParams({
        count: '100',
        cursor: '0',
        ...COMMON_PARAMS,
        aid: '1128',
        msToken: ''
      })

      const url = `${API.collections}?${params.toString()}`
      const signedUrl = await this.signUrl(url, cookie)

      const response = await client.get<{
        status_code: number
        collection_list?: Array<{
          collection_id?: string
          name?: string
          item_count?: number
        }>
      }>(
        signedUrl,
        undefined,
        {
          referer: 'https://creator.douyin.com/creator-micro/content/publish',
          Origin: 'https://creator.douyin.com',
          'x-secsdk-csrf-token': csrfToken
        }
      )

      if (response.data.status_code !== 0 || !response.data.collection_list) {
        logger.warn(`[douyin] Collections fetch failed: status=${response.data.status_code}`)
        return []
      }

      return response.data.collection_list
        .filter((c) => c.collection_id && c.name)
        .map((c) => ({
          label: c.name!,
          value: c.collection_id!
        }))
    } catch (err) {
      logger.error('[douyin] getCollections error:', err)
      return []
    }
  }

  // --- Signature helpers ---

  /**
   * Add a_bogus signature to a Douyin API URL.
   * Uses the local SignService to generate the signature.
   * Passes the URL as data so the external signing service can use it.
   */
  private async signUrl(url: string, cookie: string, body?: string): Promise<string> {
    try {
      const signService = getSignService()
      const signature = await signService.getSignature('douyin', cookie, url, body)
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

  /**
   * Get CSRF token required for upload operations.
   * Uses HEAD request with CSRF headers, rotating through 3 URLs on retry.
   * Matches yixiaoer's getSdkToken$2 implementation.
   */
  private async getCsrfToken(client: HttpClient, retryIndex: number = 0): Promise<string> {
    const csrfUrls = [
      'https://creator.douyin.com/web/api/media/anchor/search',
      'https://creator.douyin.com/web/api/media/aweme/create/',
      'https://creator.douyin.com/aweme/v1/creator/homepage/module/'
    ]
    const url = csrfUrls[retryIndex % csrfUrls.length]

    try {
      const response = await client.head<unknown>(
        url,
        {
          Accept: 'application/json, text/plain, */*',
          referer: 'https://creator.douyin.com/content/upload',
          'x-secsdk-csrf-request': '1',
          'x-secsdk-csrf-version': '1.2.7'
        }
      )
      // Extract token from x-ware-csrf-token header — format: "something,<token>"
      const tokenHeader = (response.headers?.['x-ware-csrf-token'] as string) || ''
      const token = tokenHeader.split(',')[1] || tokenHeader || ''
      logger.info(`[douyin] CSRF token obtained (url index ${retryIndex}): ${token ? 'yes' : 'no'}`)
      return token
    } catch (err) {
      logger.warn('[douyin] getCsrfToken error:', err)
      return ''
    }
  }

  /**
   * Get upload auth credentials from Xigua Studio API.
   * Returns STS credentials for ByteDance VOD service.
   *
   * Response: { data: { uploadToken: { AccessKeyID, SecretAccessKey, SessionToken } } }
   */
  private async getUploadAuth(client: HttpClient): Promise<{
    AccessKeyID: string
    SecretAccessKey: string
    SessionToken: string
  }> {
    const url = `${API.uploadAuth}?type=video&isLandscape=true`

    const response = await client.get<Record<string, unknown>>(
      url,
      undefined,
      {
        Accept: 'application/json, text/plain, */*',
        referer: 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page',
        'x-secsdk-csrf-token': 'DOWNGRADE'
      }
    )

    const resData = response.data
    logger.info(`[douyin] uploadAuth response keys: ${Object.keys(resData || {}).join(', ')}`)

    // Try format 1: nested { data: { uploadToken: { AccessKeyID, SecretAccessKey, SessionToken } } }
    const nestedToken = (resData as any)?.data?.uploadToken
    if (nestedToken?.AccessKeyID || nestedToken?.AccessKeyId) {
      return {
        AccessKeyID: nestedToken.AccessKeyID || nestedToken.AccessKeyId || '',
        SecretAccessKey: nestedToken.SecretAccessKey || '',
        SessionToken: nestedToken.SessionToken || ''
      }
    }

    // Try format 2: flat { ak, auth } where auth is JSON string with STS credentials
    const ak = (resData as any)?.ak
    const authRaw = (resData as any)?.auth
    if (ak && authRaw) {
      try {
        const authObj = typeof authRaw === 'string' ? JSON.parse(authRaw) : authRaw
        const accessKeyId = authObj.AccessKeyID || authObj.AccessKeyId || ak
        const secretAccessKey = authObj.SecretAccessKey || ''
        const sessionToken = authObj.SessionToken || ''
        logger.info(`[douyin] Parsed flat auth format, AccessKeyID: ${accessKeyId.substring(0, 10)}...`)
        return { AccessKeyID: accessKeyId, SecretAccessKey: secretAccessKey, SessionToken: sessionToken }
      } catch (e) {
        logger.warn('[douyin] Failed to parse auth JSON, using ak directly')
        return { AccessKeyID: ak, SecretAccessKey: '', SessionToken: '' }
      }
    }

    logger.error('[douyin] uploadAuth missing credentials:', JSON.stringify(resData).substring(0, 300))
    throw new Error('获取上传凭证失败：服务器未返回认证信息')
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

    // Step 1: Get STS credentials from Douyin
    const stsAuth = await this.getUploadAuth(client)
    logger.info(`[douyin] STS credentials obtained, AccessKeyID: ${stsAuth.AccessKeyID.substring(0, 10)}...`)

    // Step 2: Call ApplyUploadInner with AWS4 signing
    const userId = await this.getCreatorUserId(client)
    const sessionToken = randomBytes(16).toString('hex')

    let uploadNodes: Array<{
      UploadHost?: string
      StoreInfos?: Array<{ StoreUri: string; Auth?: string }>
      SessionKey?: string
    }> = []

    try {
      // Build AWS4-signed request for VOD API
      const vodParams = {
        Action: 'ApplyUploadInner',
        Version: '2020-11-19',
        SpaceName: 'aweme',
        FileType: 'video',
        IsInner: '1',
        FileSize: stats.size.toString(),
        app_id: '2906',
        user_id: userId,
        s: sessionToken
      }
      const qs = new URLSearchParams(vodParams).toString()
      const signOpts = {
        host: 'vod.bytedanceapi.com',
        path: `/?${qs}`,
        method: 'GET',
        service: 'vod',
        region: 'cn-north-1',
        headers: { Referer: 'https://studio.ixigua.com/' },
        signQuery: true
      }
      aws4.sign(signOpts, {
        accessKeyId: stsAuth.AccessKeyID,
        secretAccessKey: stsAuth.SecretAccessKey,
        sessionToken: stsAuth.SessionToken
      })

      const signedUrl = `https://vod.bytedanceapi.com${signOpts.path}`
      const vodResponse = await client.get<{
        Result?: {
          InnerUploadAddress?: {
            UploadNodes?: Array<{
              UploadHost?: string
              StoreInfos?: Array<{ StoreUri: string; Auth?: string }>
              SessionKey?: string
            }>
          }
        }
        ResponseMetadata?: { Error?: { Code?: string; Message?: string } }
      }>(
        signedUrl,
        undefined,
        { Referer: 'https://studio.ixigua.com/' },
        true // noCookie: VOD API rejects requests with douyin.com cookies
      )

      const innerAddress = vodResponse.data?.Result?.InnerUploadAddress
      if (!innerAddress?.UploadNodes?.length) {
        logger.error('[douyin] ApplyUploadInner failed:', JSON.stringify(vodResponse.data).substring(0, 500))
        throw new Error('获取上传地址失败')
      }

      uploadNodes = innerAddress.UploadNodes
      logger.info(`[douyin] Upload address obtained, host: ${uploadNodes[0].UploadHost}`)
    } catch (err) {
      logger.error('[douyin] ApplyUploadInner error:', err)
      throw new Error(`获取上传凭证失败: ${err}`)
    }

    // Step 3: Upload video to ByteDance VOD
    const node = uploadNodes[0]
    const storeInfo = node.StoreInfos?.[0]
    if (!node.UploadHost || !storeInfo?.StoreUri) {
      throw new Error('上传地址无效')
    }

    const uploadUrl = `https://${node.UploadHost}/upload/v1/${storeInfo.StoreUri}`
    const fileBuffer = readFileSync(filePath)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    try {
      const vodUploadResponse = await client.request<{
        code?: number
        message?: string
      }>({
        method: 'POST',
        url: uploadUrl,
        data: fileBuffer,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Storage-U': userId,
          Authorization: storeInfo.Auth || '',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page'
        },
        timeout: 300_000,
        noCookie: true,
        onUploadProgress: (progress) => {
          const percent = 10 + Math.round(progress.percent * 0.7)
          onProgress?.({ percent, stage: `上传中 ${progress.percent}%` })
        }
      })

      logger.info(`[douyin] Video uploaded to VOD`)
      onProgress?.({ percent: 80, stage: '正在提交上传...' })
    } catch (err) {
      logger.error('[douyin] VOD upload error:', err)
      throw new Error(`视频上传失败: ${err}`)
    }

    // Step 4: Commit the upload with AWS4 signing
    try {
      const commitParams = {
        SessionKey: node.SessionKey || '',
        Functions: []
      }
      const commitBody = JSON.stringify(commitParams)

      const commitQs = new URLSearchParams({
        Action: 'CommitUploadInner',
        Version: '2020-11-19',
        SpaceName: 'aweme',
        app_id: '2906',
        user_id: userId
      }).toString()
      const commitSignOpts = {
        host: 'vod.bytedanceapi.com',
        path: `/?${commitQs}`,
        method: 'POST',
        service: 'vod',
        region: 'cn-north-1',
        headers: {
          'Content-Type': 'application/json',
          'X-Amz-Content-Sha256': createHash('sha256').update(commitBody).digest('hex')
        },
        body: commitBody
      }
      aws4.sign(commitSignOpts, {
        accessKeyId: stsAuth.AccessKeyID,
        secretAccessKey: stsAuth.SecretAccessKey,
        sessionToken: stsAuth.SessionToken
      })

      const commitUrl = `https://vod.bytedanceapi.com${commitSignOpts.path}`
      const commitResponse = await client.request<{
        Result?: { Results?: Array<{ Vid: string }> }
        ResponseMetadata?: { Error?: { Code?: string; Message?: string } }
      }>({
        method: 'POST',
        url: commitUrl,
        data: commitBody,
        headers: {
          ...commitSignOpts.headers as Record<string, string>,
          Referer: 'https://studio.ixigua.com/'
        },
        noCookie: true
      })

      const vid = commitResponse.data?.Result?.Results?.[0]?.Vid
      logger.info(`[douyin] Upload committed, vid: ${vid}`)
      onProgress?.({ percent: 90, stage: '视频上传完成' })

      return vid || ''
    } catch (err) {
      logger.error('[douyin] Commit upload error:', err)
      throw new Error(`提交上传失败: ${err}`)
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const cookie = client.getCookieString()

    // Build hashtags text_extra array and full text with inline hashtags
    const textExtra: Array<Record<string, unknown>> = []
    let fullText = `${payload.title || ''} ${payload.description || ''}`
    let offset = (payload.title?.length || 0) + 1
    for (const tag of payload.hashtags) {
      const tagText = `#${tag} `
      textExtra.push({
        start: offset,
        type: 1,
        user_id: '',
        hashtag_id: 0,
        end: offset + tagText.length - 1,
        hashtag_name: tag,
        caption_start: 0,
        caption_end: tagText.length
      })
      fullText += tagText
      offset += tagText.length
    }

    // Build the create_v2 request body (matching yixiaoer's buildPostData_v2 structure)
    const postData: Record<string, unknown> = {
      item: {
        common: {
          text: fullText,
          caption: payload.description || '',
          item_title: payload.title || '',
          activity: '[]',
          text_extra: textExtra.length > 0 ? JSON.stringify(textExtra) : '',
          challenges: payload.hashtags.length > 0 ? JSON.stringify(payload.hashtags.map((t) => ({ cha_name: t, cid: '', type: 1, view_count: 0 }))) : '[]',
          mentions: '[]',
          hashtag_source: '',
          hot_sentence: '',
          visibility_type: 0,
          download: 1,
          timing: 0,
          creation_id: `jdhajhsh${Date.now()}`,
          media_type: 4,
          video_id: videoId || '',
          music_source: 0,
          music_id: '',
          music_end_time: 1000
        },
        cooperation: { co_info: '' },
        cover: {
          custom_cover_image_height: 335,
          custom_cover_image_width: 251,
          poster: '',
          poster_delay: 0,
          horizontal_custom_cover_image_uri: '',
          horizontal_cover_tsp: 0,
          horizontal_custom_cover_image_height: 335,
          horizontal_custom_cover_image_width: 447,
          cover_tools_extend_info: '',
          cover_tools_info: ''
        },
        mix: {},
        chapter: {
          chapter: JSON.stringify({
            chapter_abstract: '',
            chapter_details: [],
            chapter_type: 1,
            chapter_tools_info: {
              chapter_recommend_detail: [],
              chapter_recommend_abstract: '',
              chapter_source: 2,
              chapter_recommend_type: -2,
              create_date: Date.now() / 1000,
              is_pc: '1',
              is_pre_generated: '0',
              is_syn: '1'
            }
          })
        },
        anchor: {},
        sync: {
          limit_client_keys: undefined,
          should_sync: false,
          sync_to_toutiao: 0
        },
        open_platform: {},
        assistant: { is_preview: 0, is_post_assistant: 1 },
        declare: { user_declare_info: '{}' }
      }
    }

    // Add platform-specific fields
    if (payload.platformFields) {
      if (payload.platformFields.collection) {
        ;(postData.item as Record<string, unknown>).collection_id = payload.platformFields.collection
      }

      // Add POI location if provided
      // poiLocation is a LocationResult object from LocationSearch component
      if (payload.platformFields.poiLocation) {
        const loc = payload.platformFields.poiLocation
        if (typeof loc === 'object' && loc !== null && 'name' in loc) {
          const locObj = loc as { name: string; poi_id?: string; lat?: number; lng?: number; address?: string }
          const common = (postData.item as Record<string, unknown>).common as Record<string, unknown>
          common.poi_info = JSON.stringify({
            poi_id: locObj.poi_id || '',
            poi_name: locObj.name,
            address: locObj.address || '',
            ...(locObj.lat ? { latitude: locObj.lat } : {}),
            ...(locObj.lng ? { longitude: locObj.lng } : {})
          })
          logger.info(`[douyin] Added POI location: ${locObj.name}`)
        }
      }

      // Download permission: ['allow'] = allow, ['deny'] = disallow
      if (Array.isArray(payload.platformFields.downloadPermission)) {
        const perm = payload.platformFields.downloadPermission as string[]
        const common = (postData.item as Record<string, unknown>).common as Record<string, unknown>
        common.download = perm.includes('deny') ? 0 : 1
      }

      // Declarations: map selected options to Douyin's user_declare_info format
      if (Array.isArray(payload.platformFields.declarations) && payload.platformFields.declarations.length > 0) {
        const declare = (postData.item as Record<string, unknown>).declare as Record<string, unknown>
        declare.user_declare_info = JSON.stringify(
          (payload.platformFields.declarations as string[]).map((d) => ({ protocol_name: d }))
        )
        logger.info(`[douyin] Added declarations: ${payload.platformFields.declarations.join(', ')}`)
      }
    }

    try {
      // Get CSRF token
      const csrfToken = await this.getCsrfToken(client)

      // Extract bd_ticket_guard data from cookie
      const bdTicketKey = this.extractBdTicketGuardKey(cookie)
      const clientData = this.clientSign(cookie)
      const guardVersion = this.getTicketGuardVersion(cookie)

      // Pre-check: call publishlimit endpoint (required by yixiaoer's flow)
      try {
        const limitParams = new URLSearchParams({
          device_platform: 'pc',
          ...COMMON_PARAMS,
          aid: '1128',
          msToken: '',
          a_bogus: ''
        })
        const limitUrl = `https://creator.douyin.com/aweme/v1/open/publish/limit_app_groups/?${limitParams.toString()}`
        await client.post(limitUrl, '', {
          referer: 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page',
          Origin: 'https://creator.douyin.com',
          'x-secsdk-csrf-token': csrfToken
        })
        logger.info('[douyin] publishlimit check passed')
      } catch (limitErr) {
        logger.warn('[douyin] publishlimit check failed (non-fatal):', limitErr)
      }

      // Get msToken from sign service page (set by Douyin's JS) or extract from cookie
      const signService = getSignService()
      let msToken = await signService.getCookieFromPage('douyin', 'msToken')
      if (!msToken) {
        msToken = this.extractMsToken(cookie)
      }
      logger.info(`[douyin] Using msToken: ${msToken.substring(0, 15)}...`)
      const queryParams = new URLSearchParams({
        read_aid: '2906',
        ...COMMON_PARAMS,
        support_h265: '1',
        msToken
      })
      const baseUrl = `${API.awemeCreate}?${queryParams.toString()}`
      const signedUrl = await this.signUrl(baseUrl, cookie, JSON.stringify(postData))

      const response = await client.post<{
        status_code: number
        status_msg?: string
        aweme_id?: string
      }>(
        signedUrl,
        JSON.stringify(postData),
        {
          'Content-Type': 'application/json',
          'x-secsdk-csrf-token': csrfToken,
          'bd-ticket-guard-web-version': guardVersion,
          'bd-ticket-guard-version': '2',
          'bd-ticket-guard-iteration-version': '1',
          'bd-ticket-guard-web-sign-type': '0',
          'bd-ticket-guard-ree-public-key': bdTicketKey,
          ...(clientData ? { 'bd-ticket-guard-client-data': clientData } : {}),
          Referer: 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page',
          Origin: 'https://creator.douyin.com/'
        }
      )

      if (response.data.status_code !== 0) {
        throw new Error(`内容提交失败: ${response.data.status_msg || '未知错误'}`)
      }

      logger.info(`[douyin] Content submitted, aweme_id: ${response.data.aweme_id}`)
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

  /**
   * Get creator user ID from Douyin creator API.
   * This is the numeric uid needed for VOD API calls.
   */
  private async getCreatorUserId(client: HttpClient): Promise<string> {
    try {
      const response = await client.get<{
        status_code?: number
        user?: { uid?: string; id_str?: string; sec_uid?: string }
      }>(
        API.userInfo,
        undefined,
        {
          referer: 'https://creator.douyin.com/creator-micro/home',
          Origin: 'https://creator.douyin.com'
        }
      )
      const uid = response.data?.user?.uid || response.data?.user?.id_str || ''
      logger.info(`[douyin] Creator user ID: ${uid}`)
      return uid || '0'
    } catch (err) {
      logger.warn('[douyin] Failed to get creator user ID, falling back to cookie extraction:', err)
      return this.extractUserIdFallback(client.getCookieString())
    }
  }

  /**
   * Fallback: extract user_id from cookie string.
   */
  private extractUserIdFallback(cookie: string): string {
    const sidMatch = cookie.match(/sessionid=([^;]+)/)
    return sidMatch?.[1] || '0'
  }

  /**
   * Compute SHA-256 hex digest.
   */
  private sha256Hex(data: string): string {
    return createHash('sha256').update(data).digest('hex')
  }

  /**
   * Determine bd-ticket-guard-web-version from cookie's ticket format.
   * Returns "2" if ticket starts with "hash", otherwise "1".
   */
  private getTicketGuardVersion(cookie: string): string {
    try {
      const match = cookie.match(/security-sdk\/s_sdk_sign_data_key\/web_protect=([^;]+)/)
      if (match) {
        const decoded = JSON.parse(JSON.parse(decodeURIComponent(match[1])).data)
        return decoded.ticket?.startsWith('hash') ? '2' : '1'
      }
    } catch {
      // Ignore parse errors
    }
    return '1'
  }

  /**
   * Extract bd-ticket-guard-ree-public-key from cookie's bd_ticket_guard_client_data.
   */
  private extractBdTicketGuardKey(cookie: string): string {
    try {
      const match1 = cookie.match(/bd_ticket_guard_client_data=([^;]+)/)
      if (match1) {
        const decoded = Buffer.from(decodeURIComponent(match1[1]), 'base64').toString('utf-8')
        const parsed = JSON.parse(decoded)
        return parsed['bd-ticket-guard-ree-public-key'] || ''
      }
      const match2 = cookie.match(/bd_ticket_guard_client_data_v2=([^;]+)/)
      if (match2) {
        const decoded = Buffer.from(decodeURIComponent(match2[1]), 'base64').toString('utf-8')
        const parsed = JSON.parse(decoded)
        return parsed.ree_public_key || ''
      }
    } catch {
      // Ignore parse errors
    }
    return ''
  }

  /**
   * Generate bd-ticket-guard-client-data signature for create_v2.
   * Uses EC private key from cookie's security-sdk fields to sign the request.
   */
  private clientSign(cookie: string): string {
    try {
      // Extract EC private key
      const cryptMatch = cookie.match(/security-sdk\/s_sdk_crypt_sdk=([^;]+)/)
      if (!cryptMatch) return ''

      const cryptData = JSON.parse(JSON.parse(decodeURIComponent(cryptMatch[1])).data)
      const privateKeyPem = cryptData.ec_privateKey

      // Extract ticket and ts_sign
      const protectMatch = cookie.match(/security-sdk\/s_sdk_sign_data_key\/web_protect=([^;]+)/)
      if (!protectMatch) return ''

      const protectData = JSON.parse(JSON.parse(decodeURIComponent(protectMatch[1])).data)
      const { ticket, ts_sign } = protectData

      // Sign: ticket={ticket}&path=/web/api/media/aweme/create_v2/&timestamp={ts}
      const timestamp = Math.floor(Date.now() / 1000)
      const payload = `ticket=${ticket}&path=/web/api/media/aweme/create_v2/&timestamp=${timestamp}`

      const key = createPrivateKey(privateKeyPem)
      const signer = createSign('SHA256')
      signer.update(payload)
      signer.end()
      const reqSign = signer.sign(key, 'base64')

      return Buffer.from(JSON.stringify({
        ts_sign,
        req_content: 'ticket,path,timestamp',
        req_sign: reqSign,
        timestamp
      })).toString('base64')
    } catch (err) {
      logger.warn('[douyin] clientSign failed (cookie may lack security-sdk fields):', err)
      return ''
    }
  }

  /**
   * Get recommended POI locations on Douyin.
   * Uses the life video API search endpoint with search_type=0 and poi_mode=1.
   * Reference: yixiaoer implementation
   */
  async getRecommendLocations(client: HttpClient, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()
      const csrfToken = await this.getCsrfToken(client)

      logger.info(`[douyin] getRecommendLocations called with options:`, options)

      // 使用和 yixiaoer 相同的 API 和参数
      const params = new URLSearchParams({
        count: String(options?.count || 12),
        from_webapp: '1',
        get_current_loc: '1',
        keywords: '',
        search_type: '0',
        poi_anchor_tab: '2',
        page: '1',
        ...COMMON_PARAMS,
        aid: '1128',
        msToken: '',
        _signature: '',
        poi_mode: '1',
        latitude: String(options?.lat || 0),
        longitude: String(options?.lng || 0)
      })

      const url = `${API.poiSearch}?${params.toString()}`
      const signedUrl = await this.signUrl(url, cookie)

      logger.debug(`[douyin] POI recommend URL: ${signedUrl}`)

      const response = await client.get<{
        status_code: number
        poi_list?: Array<{
          poi_id?: string
          poi_name?: string
          address?: string
          latitude?: number
          longitude?: number
          city?: string
          district?: string
          address_info?: {
            city?: string
            city_code?: string
            district?: string
          }
        }>
        current_locs?: Array<{
          poi_id?: string
          poi_name?: string
          address?: string
          latitude?: number
          longitude?: number
          city?: string
          district?: string
          address_info?: {
            city?: string
            city_code?: string
            district?: string
          }
        }>
      }>(
        signedUrl,
        undefined,
        {
          referer: 'https://creator.douyin.com/creator-micro/content/publish',
          Origin: 'https://creator.douyin.com',
          'x-secsdk-csrf-token': csrfToken
        }
      )

      // yixiaoer: concatenate current_locs before poi_list
      const currentLocs = response.data.current_locs || []
      const poiList = response.data.poi_list || []
      const allPois = [...currentLocs, ...poiList]

      logger.info(`[douyin] POI recommend response status: ${response.data.status_code}, current_locs: ${currentLocs.length}, poi_list: ${poiList.length}`)

      if (response.data.status_code !== 0) {
        logger.warn(`[douyin] POI recommend failed: status=${response.data.status_code}`)
        return []
      }

      const results: import('../IPlatformAdapter').LocationResult[] = allPois.map((poi) => ({
        id: poi.poi_id || '',
        name: poi.poi_name || '',
        address: poi.address || [poi.address_info?.city, poi.address_info?.district, poi.address].filter(Boolean).join(''),
        lat: poi.latitude,
        lng: poi.longitude,
        poi_id: poi.poi_id,
        extra: { city: poi.address_info?.city, district: poi.address_info?.district, city_code: poi.address_info?.city_code }
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
      logger.error('[douyin] getRecommendLocations error:', err)
      return []
    }
  }

  /**
   * Search POI locations on Douyin.
   * Uses the life video API search endpoint with keyword.
   */
  async searchLocation(client: HttpClient, keyword: string, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()
      const csrfToken = await this.getCsrfToken(client)

      const params = new URLSearchParams({
        count: String(options?.count || 12),
        from_webapp: '1',
        get_current_loc: '1',
        keywords: keyword,
        search_type: 'poi',
        poi_anchor_tab: '2',
        page: '1',
        ...COMMON_PARAMS,
        aid: '1128',
        msToken: ''
      })

      // 如果有经纬度，添加到参数中
      if (options?.lat && options?.lng) {
        params.set('latitude', String(options.lat))
        params.set('longitude', String(options.lng))
      }

      const url = `${API.poiSearch}?${params.toString()}`
      const signedUrl = await this.signUrl(url, cookie)

      const response = await client.get<{
        status_code: number
        poi_list?: Array<{
          poi_id?: string
          poi_name?: string
          address?: string
          simple_address_str?: string
          latitude?: number
          longitude?: number
          city?: string
          district?: string
          address_info?: {
            city?: string
            city_code?: string
            district?: string
          }
        }>
      }>(
        signedUrl,
        undefined,
        {
          referer: 'https://creator.douyin.com/creator-micro/content/publish',
          Origin: 'https://creator.douyin.com',
          'x-secsdk-csrf-token': csrfToken
        }
      )

      if (response.data.status_code !== 0 || !response.data.poi_list) {
        logger.warn(`[douyin] POI search failed: status=${response.data.status_code}`)
        return []
      }

      return response.data.poi_list.map((poi) => ({
        id: poi.poi_id || '',
        name: poi.poi_name || '',
        address: poi.simple_address_str || poi.address || [poi.address_info?.city, poi.address_info?.district, poi.address].filter(Boolean).join(''),
        lat: poi.latitude,
        lng: poi.longitude,
        poi_id: poi.poi_id,
        extra: { city: poi.address_info?.city || poi.city, district: poi.address_info?.district || poi.district }
      }))
    } catch (err) {
      logger.error('[douyin] searchLocation error:', err)
      return []
    }
  }
}
