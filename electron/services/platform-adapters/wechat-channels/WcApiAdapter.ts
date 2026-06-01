import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { WC_URLS } from './wc-urls'
import { WC_SELECTORS } from './wc-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, createReadStream, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { ffmpegService } from '../../ffmpeg/FFmpegService'

// WeChat Channels API endpoints (reverse-engineered from yixiaoer)
const API = {
  authData: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
  uploadParams: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params',
  publish: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_create',
  draft: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_draft'
}

/**
 * Generate 13-digit timestamp matching yixiaoer's getTimeStamp(13)
 */
function getTimestamp13(): string {
  return Date.now().toString().substring(0, 13)
}

export class WcApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'wechat-channels'
  readonly platformName = '视频号'
  readonly loginUrl = WC_URLS.login

  // Cached finder info from auth_data response
  private cachedFinderUsername: string = ''
  private cachedFinderUin: number = 0

  // Last upload result for submitContentAPI
  private lastUploadResult: {
    downloadUrl: string
    uploadId: string
    fileSize: number
    fileName: string
    clipKey: string
    draftId: string
    videoWidth: number
    videoHeight: number
    videoDuration: number
    md5sum: string
    authKey: string
    uin: string
  } | null = null

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
        name: 'location',
        type: 'location',
        label: '位置信息',
        placeholder: '搜索位置'
      },
      {
        name: 'collection',
        type: 'dynamic-select',
        label: '添加合集',
        placeholder: '选择合集',
        dynamicKey: 'collections'
      },
      {
        name: 'originalDeclaration',
        type: 'checkbox',
        label: '声明原创',
        defaultValue: false
      }
    ]
  }

  // --- Browser mode (legacy) ---

  async startLogin(context: BrowserContext): Promise<Page> {
    this.loginCheckCount = 0
    return super.startLogin(context)
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[wechat-channels] Waiting for QR code...')

    // Wait for page to settle
    await delay(500)

    // Try QR element selector first (fast path)
    for (let i = 0; i < 5; i++) {
      try {
        const qrEl = await page.$(WC_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[wechat-channels] QR code element captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(500)
    }

    // Fallback: full page screenshot (QR might be rendered differently)
    logger.info('[wechat-channels] QR element not found, taking page screenshot')
    try {
      const screenshot = await page.screenshot({ clip: { x: 0, y: 0, width: 1366, height: 768 } })
      return `data:image/png;base64,${screenshot.toString('base64')}`
    } catch (e) {
      logger.error('[wechat-channels] Screenshot failed:', e)
      return null
    }
  }

  private loginCheckCount = 0

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    try {
      this.loginCheckCount++

      // Need at least 10 checks (~5s) before detecting login — user needs time to scan QR
      if (this.loginCheckCount < 10) return false

      const context = page.context()

      // After QR scan, the original page may close or navigate.
      // Find a live page in the context to use for CDP session.
      let livePage: Page | null = null
      for (const p of context.pages()) {
        if (!p.isClosed()) {
          livePage = p
          break
        }
      }
      if (!livePage) {
        // All pages closed — can't check cookies yet
        if (this.loginCheckCount % 20 === 0) {
          logger.info(`[wechat-channels] All pages closed, waiting...`)
        }
        return false
      }

      const url = livePage.url()

      // Check cookies via CDP — finder_id is REQUIRED for API calls
      let hasFinderId = false
      let foundAuthCount = 0
      let wcCookies: any[] = []
      try {
        const client = await context.newCDPSession(livePage)
        const { cookies } = await client.send('Network.getAllCookies')
        await client.detach()

        wcCookies = cookies.filter((c: any) =>
          c.domain.includes('weixin') || c.domain.includes('wechat') || c.domain.includes('qq.com')
        )
        const authNames = ['finder_id', 'sessionid', 'slave_sid', 'wxuin', 'pass_ticket', 'skey']
        const foundAuth = wcCookies.filter((c: any) => authNames.includes(c.name) && c.value)
        foundAuthCount = foundAuth.length
        hasFinderId = foundAuth.some((c: any) => c.name === 'finder_id')

        if (this.loginCheckCount % 10 === 0) {
          const allNames = cookies.map((c: any) => `${c.name}@${c.domain}`).join(', ')
          logger.info(`[wechat-channels] ALL cookies (${cookies.length}): ${allNames}`)
        }
      } catch (e) {
        // CDP failed — page might be mid-navigation, try context.cookies fallback
        try {
          const allCookies = await context.cookies()
          wcCookies = allCookies.filter((c: any) =>
            c.domain.includes('weixin') || c.domain.includes('wechat') || c.domain.includes('qq.com')
          )
          const authNames = ['finder_id', 'sessionid', 'slave_sid', 'wxuin', 'pass_ticket', 'skey']
          const foundAuth = wcCookies.filter((c: any) => authNames.includes(c.name) && c.value)
          foundAuthCount = foundAuth.length
          hasFinderId = foundAuth.some((c: any) => c.name === 'finder_id')

          if (this.loginCheckCount % 20 === 0) {
            logger.info(`[wechat-channels] CDP failed, used context.cookies: ${wcCookies.length} wc | names: ${wcCookies.map((c: any) => c.name).join(', ')}`)
          }
        } catch {
          if (this.loginCheckCount % 20 === 0) {
            logger.warn('[wechat-channels] Both CDP and context.cookies failed')
          }
        }
      }

      // Login detection: sessionid + wxuin means WeChat auth succeeded.
      // finder_id is NOT a cookie — it comes from auth_data API (called by getAccountInfoAPI after login).
      const hasWechatAuth = wcCookies.some((c: any) => c.name === 'sessionid' && c.value) &&
          wcCookies.some((c: any) => c.name === 'wxuin' && c.value)

      if (hasWechatAuth) {
        logger.info(`[wechat-channels] Login detected (sessionid+wxuin found)`)
        return true
      }

      // Fallback: finder_id cookie (legacy, in case it's set in some environments)
      if (hasFinderId) {
        logger.info(`[wechat-channels] Login detected (finder_id cookie found)`)
        return true
      }

      return false
    } catch (_e) {
      return false
    }
  }

  /** Check if session is still valid (for checkSession) */
  private async isPageLoggedIn(page: Page): Promise<boolean> {
    try {
      const context = page.context()
      const cookies = await context.cookies('https://channels.weixin.qq.com')
      return cookies.some(c => c.name === 'finder_id' && c.value)
    } catch {
      return false
    }
  }

  protected async extractAccountInfo(page: Page): Promise<{ displayName?: string; avatarUrl?: string }> {
    try {
      // Use page.$() (CDP-based, no page.evaluate timeout issues)
      const extractFromPage = async (): Promise<{ displayName?: string; avatarUrl?: string }> => {
        let avatarUrl: string | undefined
        const avatarEl = await page.$('img[class*="avatar"], div[class*="avatar"] img, img[src*="avatar"]')
        if (avatarEl) {
          avatarUrl = await avatarEl.getAttribute('src') || undefined
          if (avatarUrl?.includes('default')) avatarUrl = undefined
        }

        let displayName: string | undefined
        const nameSelectors = ['span[class*="name"]', 'div[class*="nickname"]', 'span[class*="nickname"]', 'div[class*="account-name"]']
        for (const sel of nameSelectors) {
          const el = await page.$(sel)
          if (el) {
            const text = await el.textContent()
            const trimmed = text?.trim()
            if (trimmed && trimmed.length >= 2 && trimmed.length <= 20 &&
                !['首页', '发布', '数据', '管理', '创作', '视频'].includes(trimmed)) {
              displayName = trimmed
              break
            }
          }
        }
        return { displayName, avatarUrl }
      }

      // Try current page first
      let info = await extractFromPage()

      // If no name found, navigate to post/list and retry
      if (!info.displayName) {
        try {
          await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 5000 })
          info = await extractFromPage()
        } catch {
          // Navigation failed, use what we have
        }
      }

      return { displayName: info.displayName || '视频号用户', avatarUrl: info.avatarUrl }
    } catch {
      return { displayName: '视频号用户' }
    }
  }

  async checkSession(context: BrowserContext): Promise<boolean> {
    try {
      const page = await context.newPage()
      await page.goto(WC_URLS.home, { waitUntil: 'domcontentloaded', timeout: 10000 })
      const isLoggedIn = await this.isPageLoggedIn(page)
      await page.close()
      return isLoggedIn
    } catch {
      return false
    }
  }

  // --- API mode (matching yixiaoer) ---

  /**
   * Extract finder_id from cookie string.
   */
  private extractFinderId(cookie: string): string | null {
    const match = cookie.match(/finder_id=([^;]+)/)
    return match ? match[1] : null
  }

  /**
   * Get account info from API (nickname, avatar, etc.).
   * Used after login to get the correct display name.
   */
  async getAccountInfoAPI(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null> {
    try {
      const cookie = client.getCookieString()
      const finderId = this.extractFinderId(cookie)

      const body = {
        timestamp: getTimestamp13(),
        _log_finder_uin: null,
        _log_finder_id: finderId || null,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }

      const response = await client.post<{
        errCode: number
        data?: {
          finderUser?: {
            nickname: string
            finderUsername?: string
            headImgUrl?: string
            finder_id?: string
            uin?: number
          }
        }
      }>(
        API.authData,
        body,
        {
          referer: 'https://channels.weixin.qq.com/index',
          Origin: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json'
        }
      )

      logger.info(`[wechat-channels] getAccountInfoAPI response: errCode=${response.data?.errCode}, hasData=${!!response.data?.data}, hasFinderUser=${!!response.data?.data?.finderUser}`)
      if (response.data?.errCode !== 0) {
        logger.warn(`[wechat-channels] getAccountInfoAPI failed: ${JSON.stringify(response.data).substring(0, 500)}`)
      }

      if (response.data?.errCode === 0 && response.data?.data?.finderUser) {
        const user = response.data.data.finderUser
        // Cache the finder username and uin for upload requests
        this.cachedFinderUsername = user.finderUsername || user.nickname || ''
        this.cachedFinderUin = user.uin || 0
        logger.info(`[wechat-channels] getAccountInfoAPI fullFinderUser: ${JSON.stringify(user)}`)
        return {
          displayName: user.nickname,
          avatarUrl: user.headImgUrl
        }
      }

      return null
    } catch (err) {
      logger.error('[wechat-channels] getAccountInfoAPI error:', err)
      return null
    }
  }

  async checkSessionAPI(client: HttpClient): Promise<boolean> {
    try {
      const cookie = client.getCookieString()
      const finderId = this.extractFinderId(cookie)

      // POST request matching yixiaoer's auth_data call
      const body = {
        timestamp: getTimestamp13(),
        _log_finder_uin: null,
        _log_finder_id: finderId || null,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }

      const response = await client.post<{
        errCode: number
        errMsg?: string
        data?: {
          finderUser?: {
            nickname: string
            finderUsername?: string
            finder_id?: string
            headImgUrl?: string
            uin?: number
          }
        }
      }>(
        API.authData,
        body,
        {
          referer: 'https://channels.weixin.qq.com/index',
          Origin: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data?.errCode === 0 && response.data?.data?.finderUser) {
        const user = response.data.data.finderUser
        // Cache the finder username and uin for upload requests
        this.cachedFinderUsername = user.finderUsername || user.nickname || ''
        this.cachedFinderUin = user.uin || 0
        logger.info(`[wechat-channels] Session valid, user: ${user.nickname}, finderUsername: ${this.cachedFinderUsername}, uin: ${this.cachedFinderUin}, fullFinderUser: ${JSON.stringify(user)}`)
        return true
      }

      logger.warn(`[wechat-channels] Session invalid: errCode=${response.data?.errCode}, msg=${response.data?.errMsg}`)
      return false
    } catch (err) {
      logger.error('[wechat-channels] checkSessionAPI error:', err)
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

    // Probe video metadata (width, height, duration)
    let videoWidth = 0, videoHeight = 0, videoDuration = 0
    try {
      const probe = await ffmpegService.probeVideo(filePath)
      videoWidth = probe.width || 0
      videoHeight = probe.height || 0
      videoDuration = Math.round(probe.duration || 0)
      logger.info(`[wechat-channels] Video probed: ${videoWidth}x${videoHeight}, duration=${videoDuration}s`)
    } catch (e) {
      logger.warn(`[wechat-channels] Video probe failed, using defaults: ${e}`)
    }

    onProgress?.({ percent: 5, stage: '正在获取上传凭证...' })

    // Step 1: Get upload params via POST (matching yixiaoer)
    // First ensure we have the finderUsername from auth_data
    if (!this.cachedFinderUsername) {
      await this.checkSessionAPI(client)
    }

    let uploadData: {
      authKey?: string
      uin?: string
      videoFileType?: number
      errMsg?: string
      errCode?: number
    } | null = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = {
          timestamp: getTimestamp13(),
          _log_finder_id: '',
          rawKeyBuff: null
        }

        const paramsResponse = await client.post<{
          errCode: number
          errMsg?: string
          data?: {
            authKey?: string
            uin?: string
            videoFileType?: number
          }
        }>(
          API.uploadParams,
          body,
          {
            referer: 'https://channels.weixin.qq.com/platform/post/create',
            Origin: 'https://channels.weixin.qq.com',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*'
          }
        )

        if (paramsResponse.data?.errCode === 0 && paramsResponse.data?.data) {
          uploadData = paramsResponse.data.data
          logger.info(`[wechat-channels] Upload params response: ${JSON.stringify(uploadData).substring(0, 500)}`)
          break
        }

        logger.warn(`[wechat-channels] Upload params attempt ${attempt + 1} failed: errCode=${paramsResponse.data?.errCode}, msg=${paramsResponse.data?.errMsg}`)
      } catch (err) {
        logger.warn(`[wechat-channels] Upload params attempt ${attempt + 1} error:`, err)
      }

      if (attempt < 2) {
        await delay(1000 * (attempt + 1))
      }
    }

    if (!uploadData?.authKey) {
      throw new Error('获取上传凭证失败，请检查登录状态')
    }

    logger.info(`[wechat-channels] Upload auth key obtained, uin: ${uploadData.uin}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Get upload ID from Tencent CDN
    // Use uin from uploadParams if available, fallback to cachedFinderUin
    const uploadUin = uploadData.uin || String(this.cachedFinderUin) || this.cachedFinderUsername
    // Use numeric fileType from API (20302 for video) instead of string 'video'
    const videoFileType = uploadData.videoFileType || 20302
    const uploadId = await this.getUploadId(client, stats.size, filePath, uploadData.authKey, String(videoFileType), uploadUin)
    if (!uploadId) {
      throw new Error('获取上传ID失败')
    }

    logger.info(`[wechat-channels] Upload ID: ${uploadId}`)

    // Step 3: Upload video chunks (get fresh authKey for each chunk)
    const downloadUrl = await this.uploadVideoChunks(client, filePath, stats.size, uploadData.authKey, uploadId, String(videoFileType), uploadUin, onProgress)

    // Store upload result for submitContentAPI
    // Use the original downloadUrl from completepartuploaddfs without transformation
    // The server expects the exact URL it returned

    // Compute video file MD5 (required by post_create API)
    const md5sum = await this.computeFileMd5(filePath)

    this.lastUploadResult = {
      downloadUrl: downloadUrl || '',
      uploadId,
      fileSize: stats.size,
      fileName: require('path').basename(filePath),
      clipKey: '',
      draftId: '',
      videoWidth,
      videoHeight,
      videoDuration,
      md5sum,
      authKey: uploadData.authKey || '',
      uin: uploadUin || ''
    }

    logger.info(`[wechat-channels] Video uploaded successfully, downloadUrl: ${(downloadUrl || '').substring(0, 100)}`)
    onProgress?.({ percent: 80, stage: '视频上传完成' })

    return uploadId
  }

  /**
   * Get upload ID from Tencent CDN using native https module.
   */
  private async getUploadId(
    _client: HttpClient,
    fileSize: number,
    filePath: string,
    authKey: string,
    fileType: string,
    uin?: string
  ): Promise<string | null> {
    const { basename } = require('path')
    const https = require('https')
    const fileName = basename(filePath)
    const weixinnum = uin || (this.cachedFinderUin ? String(this.cachedFinderUin) : '') || ''
    const taskId = Date.now().toString()

    // Match yixiaoer's exact logic: BlockPartLength is cumulative byte positions
    const CHUNK_SIZE = 8 * 1024 * 1024 // 8MB — must match uploadVideoChunks chunk size
    const blockSum = Math.ceil(fileSize / CHUNK_SIZE)
    const blockPartLength: number[] = []
    if (fileSize < CHUNK_SIZE) {
      blockPartLength.push(fileSize)
    } else {
      for (let z = 1; z <= blockSum; z++) {
        if (z * CHUNK_SIZE <= fileSize) {
          blockPartLength.push(z * CHUNK_SIZE)
        } else {
          blockPartLength.push(fileSize)
          break
        }
      }
    }

    const body = JSON.stringify({
      BlockSum: blockSum,
      BlockPartLength: blockPartLength
    })

    const xArgs = `apptype=251&filetype=${fileType}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=2`

    logger.info(`[wechat-channels] getUploadId: fileSize=${fileSize}, weixinnum=${weixinnum}, taskId=${taskId}`)
    logger.info(`[wechat-channels] getUploadId body: ${body}`)
    logger.info(`[wechat-channels] getUploadId xArgs: ${xArgs}`)

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'finderassistancea.video.qq.com',
        port: 443,
        path: '/applyuploaddfs',
        method: 'PUT',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Arguments': xArgs,
          'Authorization': authKey,
          'Content-MD5': 'null',
          'Referer': 'https://channels.weixin.qq.com/',
          'Origin': 'https://channels.weixin.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'
        }
      }, (res: any) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          logger.info(`[wechat-channels] getUploadId response: status=${res.statusCode}, data=${data.substring(0, 500)}`)
          try {
            const json = JSON.parse(data)
            if (json.UploadID) {
              resolve(json.UploadID)
            } else {
              logger.error(`[wechat-channels] getUploadId failed: ${data}`)
              resolve(null)
            }
          } catch {
            logger.error(`[wechat-channels] getUploadId parse error: ${data}`)
            resolve(null)
          }
        })
      })
      req.on('error', (err: Error) => {
        logger.error('[wechat-channels] getUploadId error:', err)
        reject(err)
      })
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('getUploadId timeout')) })
      req.write(body)
      req.end()
    })
  }

  /**
   * Upload video file to CDN with concurrent uploads.
   * Optimized for speed with larger chunks and higher concurrency.
   */
  private async uploadVideoChunks(
    client: HttpClient,
    filePath: string,
    fileSize: number,
    authKey: string,
    uploadId: string,
    fileType: string,
    uin?: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<string> {
    const CHUNK_SIZE = 16 * 1024 * 1024 // 16MB — larger chunks for faster upload
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
    const fileBuffer = readFileSync(filePath)
    const weixinnum = uin || (this.cachedFinderUin ? String(this.cachedFinderUin) : '') || ''
    const taskId = Date.now().toString()
    const fileName = require('path').basename(filePath)
    const CDN_HOST = 'finderassistancea.video.qq.com'
    const CONCURRENCY = 6 // higher concurrency for faster upload

    // PartInfo map — keyed by PartNumber (1-based), used for both verification and complete call
    const partInfoMap = new Map<number, { PartNumber: number; ETag: string }>()
    let completedChunks = 0

    const makeXArgs = (scene: number) =>
      `apptype=251&filetype=${fileType}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=${scene}`

    const commonHeaders = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'referer': 'https://channels.weixin.qq.com/platform/post/create',
      'origin': 'https://channels.weixin.qq.com',
      'accept': 'application/json, text/plain, */*'
    }

    // --- HTTP/1.1 with keep-alive (matching yixiaoer) ---
    const https = require('https')
    const agent = new https.Agent({ keepAlive: true, maxSockets: CONCURRENCY, rejectUnauthorized: false })

    const uploadChunkH1 = (i: number): Promise<{ partNum: number; etag: string }> => {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, fileSize)
      const chunk = fileBuffer.subarray(start, end)
      const contentMd5 = createHash('md5').update(chunk).digest('hex')
      const partNumber = i + 1

      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: CDN_HOST,
          port: 443,
          path: `/uploadpartdfs?PartNumber=${partNumber}&UploadID=${uploadId}`,
          method: 'PUT',
          agent,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': chunk.length,
            'content-md5': contentMd5,
            'x-arguments': makeXArgs(0),
            'authorization': authKey,
            ...commonHeaders
          }
        }, (res: any) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              // Validate ETag — must be a non-empty string
              if (json.ETag && typeof json.ETag === 'string' && json.ETag.length > 0) {
                resolve({ partNum: partNumber, etag: json.ETag })
              } else {
                reject(new Error(`Chunk ${partNumber} no ETag: ${data.substring(0, 200)}`))
              }
            } catch {
              reject(new Error(`Chunk ${partNumber} non-JSON: ${data.substring(0, 200)}`))
            }
          })
        })
        req.on('error', reject)
        req.setTimeout(120_000, () => { req.destroy(); reject(new Error(`Chunk ${partNumber} timeout`)) })
        req.write(chunk)
        req.end()
      })
    }

    // Retry wrapper for chunk uploads (matching yixiaoer's retry behavior)
    const uploadChunkWithRetry = async (i: number, maxRetries = 3): Promise<{ partNum: number; etag: string }> => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await uploadChunkH1(i)
        } catch (err: any) {
          const isRetryable = err.message?.includes('socket hang up') ||
            err.message?.includes('ECONNRESET') ||
            err.message?.includes('ETIMEDOUT') ||
            err.message?.includes('timeout') ||
            err.message?.includes('non-JSON') ||
            err.message?.includes('no ETag')
          if (isRetryable && attempt < maxRetries - 1) {
            logger.warn(`[wechat-channels] Chunk ${i + 1} attempt ${attempt + 1} failed (${err.message}), retrying...`)
            await delay(1000 * (attempt + 1))
          } else {
            throw err
          }
        }
      }
      throw new Error(`Chunk ${i + 1} failed after ${maxRetries} attempts`)
    }

    // --- Concurrency control matching yixiaoer's Promise.race pattern ---
    // This ensures ALL errors are properly awaited, not silently swallowed.
    logger.info(`[wechat-channels] Starting upload: ${totalChunks} chunks of ${CHUNK_SIZE / 1024 / 1024}MB, concurrency=${CONCURRENCY}`)

    const pending: Promise<void>[] = []
    let firstError: Error | null = null

    for (let i = 0; i < totalChunks; i++) {
      // If a previous chunk already failed, stop launching new ones
      if (firstError) break

      const p = uploadChunkWithRetry(i).then((result) => {
        completedChunks++
        logger.info(`[wechat-channels] Chunk ${result.partNum}/${totalChunks} uploaded, ETag=${result.etag.substring(0, 20)}...`)
        onProgress?.({ percent: 10 + Math.round((completedChunks / totalChunks) * 70), stage: `上传中 ${completedChunks}/${totalChunks}` })
        partInfoMap.set(result.partNum, { PartNumber: result.partNum, ETag: result.etag })
      }).catch((err: Error) => {
        logger.error(`[wechat-channels] Chunk ${i + 1} failed permanently: ${err.message}`)
        if (!firstError) firstError = err
      })

      pending.push(p)

      // When we reach concurrency limit, wait for the earliest to finish
      if (pending.length >= CONCURRENCY) {
        await pending.shift()
      }
    }

    // Drain remaining pending uploads — ALL must settle before we proceed
    await Promise.allSettled(pending)

    // Check if any chunk failed
    if (firstError) {
      agent.destroy()
      throw new Error(`视频分片上传失败: ${firstError.message}`)
    }

    if (partInfoMap.size !== totalChunks) {
      agent.destroy()
      throw new Error(`上传不完整: ${partInfoMap.size}/${totalChunks} chunks uploaded`)
    }

    // --- Build PartInfo array in PartNumber order (NOT insertion order) ---
    // yixiaoer does: for (let i = 1; i <= je.size; i++) { push(je.get(i)) }
    const partInfoArray: { PartNumber: number; ETag: string }[] = []
    for (let i = 1; i <= totalChunks; i++) {
      const info = partInfoMap.get(i)
      if (info) partInfoArray.push(info)
    }

    logger.info(`[wechat-channels] All ${totalChunks} chunks uploaded. PartInfo ordered: [${partInfoArray.map(p => p.PartNumber).join(',')}]`)

    // --- Complete multipart upload ---
    const completeBody = JSON.stringify({ TransFlag: '0_0', PartInfo: partInfoArray })
    const downloadUrl = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: CDN_HOST,
        port: 443,
        path: `/completepartuploaddfs?UploadID=${uploadId}`,
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(completeBody),
          'content-md5': 'null',
          'x-arguments': makeXArgs(2),
          'authorization': authKey,
          ...commonHeaders
        }
      }, (res: any) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => {
          logger.info(`[wechat-channels] completepartuploaddfs response: status=${res.statusCode}, data=${data.substring(0, 500)}`)
          // 404 or any non-200 is a hard failure — don't try to parse as success
          if (res.statusCode !== 200) {
            reject(new Error(`completepartuploaddfs HTTP ${res.statusCode}: ${data.substring(0, 300)}`))
            return
          }
          try {
            const json = JSON.parse(data)
            if (json.errCode && json.errCode !== 0) reject(new Error(`Complete failed: errCode=${json.errCode}, ${json.errMsg}`))
            else resolve(json.DownloadURL || json.downloadUrl || json.download_url || '')
          } catch {
            reject(new Error(`completepartuploaddfs non-JSON: ${data.substring(0, 300)}`))
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Complete timeout')) })
      req.write(completeBody)
      req.end()
    })

    logger.info(`[wechat-channels] completepartuploaddfs result downloadUrl: ${(downloadUrl || '').substring(0, 100)}`)
    agent.destroy()

    if (!downloadUrl) {
      throw new Error('completepartuploaddfs 返回空 DownloadURL')
    }

    return downloadUrl
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const cookie = client.getCookieString()
    // finderId: the finder_id from cookie, fallback to finderUsername (used in outer envelope)
    const finderId = this.extractFinderId(cookie) || this.cachedFinderUsername || ''
    // finderUsername: the finderUsername from auth_data (used in report._log_finder_id and post_clip_video)
    const finderUsername = this.cachedFinderUsername || ''

    // Build description with hashtags inline
    let desc = payload.title || ''
    if (payload.description) {
      desc += '\n' + payload.description
    }

    // Build location — yixiaoer sends {} by default, only populates if location data exists
    // location is a LocationResult object from LocationSearch component
    let location: Record<string, unknown> = {}
    if (payload.platformFields?.location) {
      const loc = payload.platformFields.location
      if (typeof loc === 'object' && loc !== null && 'name' in loc) {
        const locObj = loc as { name: string; poi_id?: string; lat?: number; lng?: number; address?: string; extra?: Record<string, unknown> }
        // yixiaoer format: uses poiClassifyId (not poiId), and includes city
        location = {
          latitude: locObj.lat || 0,
          longitude: locObj.lng || 0,
          city: (locObj.extra?.city as string) || '',
          poiName: locObj.name,
          address: locObj.address || '',
          poiClassifyId: locObj.poi_id || ''
        }
        logger.info(`[wechat-channels] Added location: ${locObj.name}`)
      }
    }

    // Use upload result data for media info
    const uploadResult = this.lastUploadResult
    const rawDownloadUrl = uploadResult?.downloadUrl || ''
    const fileSize = uploadResult?.fileSize || 0
    const md5sum = uploadResult?.md5sum || ''

    // Transform downloadUrl to https://finder.video.qq.com/... format (matching yixiaoer)
    // yixiaoer: const at = "https://finder.video.qq.com" + Et.DownloadURL.toString().split("qq.com")[1]
    const downloadUrl = rawDownloadUrl
      ? 'https://finder.video.qq.com' + rawDownloadUrl.split('qq.com')[1]
      : rawDownloadUrl

    // Step 1: Call post_clip_video (saveTmpPostDraft) to get draftId + clipKey — REQUIRED by the API
    let draftId = uploadResult?.draftId || uploadResult?.uploadId || videoId || ''
    let clipKey = uploadResult?.clipKey || ''
    // Use actual video dimensions if available, fallback to defaults (matching yixiaoer)
    const videoWidth = uploadResult?.videoWidth || 1280
    const videoHeight = uploadResult?.videoHeight || 1920
    const videoDuration = uploadResult?.videoDuration || 59
    try {
      // Compute target dimensions matching yixiaoer's logic
      let targetWidth = videoWidth
      let targetHeight = videoHeight
      if (videoWidth > 0 && videoHeight > videoWidth) {
        const ratio = parseFloat((videoWidth / videoHeight).toFixed(5))
        if (videoHeight === videoWidth && videoWidth >= 1080) {
          targetWidth = 1080; targetHeight = 1080
        } else if (videoWidth > 1920) {
          targetWidth = 1920; targetHeight = parseInt((1920 / ratio).toFixed(0))
        }
      }

      const clipBody = {
        url: downloadUrl,
        timeStart: 0,
        cropDuration: 0,
        height: videoHeight,
        width: videoWidth,
        x: 0,
        y: 0,
        clipOriginVideoInfo: { width: videoWidth, height: videoHeight, duration: videoDuration, fileSize },
        traceInfo: {
          traceKey: `FPT_${Date.now().toString().substring(0, 10)}_1378746213`,
          uploadCdnStart: Date.now().toString().substring(0, 10),
          uploadCdnEnd: Date.now().toString().substring(0, 10)
        },
        targetWidth,
        targetHeight,
        type: 4,
        timestamp: getTimestamp13().toString(),
        _log_finder_uin: null,
        _log_finder_id: this.cachedFinderUsername || null,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }
      const clipResp = await client.post<{
        errCode?: number
        data?: { draftId?: string; clipKey?: string; videoClipTaskId?: string }
      }>(
        'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_clip_video',
        clipBody,
        { referer: 'https://channels.weixin.qq.com/platform/post/create' }
      )
      // yixiaoer expects draftId and clipKey from response
      const respDraftId = clipResp.data?.data?.draftId || clipResp.data?.data?.videoClipTaskId
      const respClipKey = clipResp.data?.data?.clipKey || ''
      if (respDraftId) {
        draftId = respDraftId
        clipKey = respClipKey
        logger.info(`[wechat-channels] post_clip_video success, draftId: ${draftId}, clipKey: ${clipKey}`)
      } else {
        logger.warn(`[wechat-channels] post_clip_video response: ${JSON.stringify(clipResp.data).substring(0, 300)}`)
      }
    } catch (e) {
      logger.warn(`[wechat-channels] post_clip_video failed, using uploadId as draftId: ${e}`)
    }

    // Step 1.5: Upload cover image if provided
    let coverUrl = ''
    if (payload.coverPath && existsSync(payload.coverPath)) {
      try {
        const authKey = uploadResult?.authKey || ''
        const uin = uploadResult?.uin || ''
        if (authKey) {
          coverUrl = await this.uploadCoverImage(client, payload.coverPath, authKey, uin, finderId)
          logger.info(`[wechat-channels] Cover uploaded: ${coverUrl.substring(0, 100)}`)
        } else {
          logger.warn('[wechat-channels] No authKey available for cover upload')
        }
      } catch (e) {
        logger.warn(`[wechat-channels] Cover upload failed: ${e}`)
      }
    }

    // Build topics array (string names, matching yixiaoer)
    const topics: string[] = payload.hashtags || []

    // Build the postReq body matching yixiaoer's buildPostData$M output
    // isFullPost: 1 for portrait (aspect <= 0.857), 0 for landscape
    const aspectRatio = videoHeight > 0 ? videoWidth / videoHeight : 0
    const isFullPost = (aspectRatio > 0.857 && aspectRatio > 0) ? 0 : 1
    const handleFlag = videoDuration > 60 ? 2 : 1

    // Generate finderTopicInfo XML matching yixiaoer's XMLWriter output
    // yixiaoer's XMLWriter escapes < and >, then .replace(/&lt;/g,"<").replace(/&gt;/g,">") converts back
    // So the final output uses actual CDATA: <![CDATA[desc]]>
    // Topics are wrapped in <topic> child elements
    const valueCount = 1 + topics.length
    const atPos = topics.length > 0 ? (topics.length + 2).toString() : '2'
    let topicXml = `<finder><version>1</version><valuecount>${valueCount}</valuecount><style><at>${atPos}</at></style>`
    topicXml += `<value0><![CDATA[${desc}]]></value0>`
    for (let i = 0; i < topics.length; i++) {
      topicXml += `<value${i + 1}><topic><![CDATA[#${topics[i]}#]]></topic></value${i + 1}>`
    }
    topicXml += '</finder>'

    // Build collection — from platformFields.collection (dynamic-select value)
    // yixiaoer puts collection inside objectDesc.topic as collectionId/collectionName
    const collectionId = (payload.platformFields?.collection as string) || ''

    const postReq: Record<string, unknown> = {
      longitude: 0,
      latitude: 0,
      feedLongitude: 0,
      feedLatitude: 0,
      originalFlag: payload.platformFields?.originalDeclaration ? 1 : 0,
      objectType: 0,
      postFlag: 0,
      isFullPost,
      handleFlag,
      topics,
      objectDesc: {
        description: desc,
        event: {},
        extReading: { link: '', title: '' },
        mediaType: 4,
        location,
        topic: {
          finderTopicInfo: topicXml,
          ...(collectionId ? { collectionId, collectionName: '' } : {})
        },
        mentionedUser: [],
        mpTitle: '',
        media: [{
          ...(coverUrl ? { coverUrl, fullCoverUrl: coverUrl, fullThumbUrl: coverUrl, thumbUrl: coverUrl, shareCoverUrl: '' } : {}),
          fileSize,
          height: videoHeight,
          md5sum,
          mediaType: 4,
          url: downloadUrl,
          urlCdnTaskId: draftId,
          videoPlayLen: videoDuration,
          width: videoWidth
        }]
      },
      report: {
        _log_finder_id: finderUsername || '',
        clipKey,
        draftId,
        // yixiaoer swaps these: height=video.width, width=video.height
        height: videoWidth || 1920,
        width: videoHeight || 1280,
        pluginSessionId: null,
        rawKeyBuff: '',
        scene: 7,
        reqScene: 7,
        timestamp: getTimestamp13(),
        duration: videoDuration,
        fileSize,
        uploadCost: Math.ceil((fileSize || 1024 * 1024) / 524287) * 1000
      },
      clientid: require('crypto').randomUUID(),
      timestamp: getTimestamp13(),
      _log_finder_id: finderUsername || '',
      scene: 7,
      reqScene: 7,
      videoClipTaskId: draftId
    }

    // Add mode + megavideoDesc for videos > 60s (matching yixiaoer)
    if (videoDuration > 60) {
      postReq.mode = 1
      postReq.megavideoDesc = {
        description: desc,
        location,
        extReading: { link: '', title: '' },
        feadLocation: { latitude: 0, longitude: 0 },
        media: [{
          ...(coverUrl ? { coverUrl, thumbUrl: coverUrl } : {}),
          url: downloadUrl,
          videoPlayLen: videoDuration,
          videoPlayLenMs: videoDuration * 1000,
          width: videoWidth,
          height: videoHeight,
          fileSize,
          md5sum
        }]
      }
    }

    // Use post_create with flat body (matching yixiaoer's default pubType=1 path)
    const postBody = JSON.stringify(postReq)

    logger.info(`[wechat-channels] Submit to post_create, body: ${postBody.substring(0, 8000)}`)
    logger.info(`[wechat-channels] Key values — downloadUrl: ${downloadUrl}, finderId: ${finderId}, finderUsername: ${finderUsername}, draftId: ${draftId}, clipKey: ${clipKey}, md5sum: ${md5sum}, coverUrl: ${coverUrl}`)

    try {
      // Use HttpClient (axios with full browser-like headers) matching yixiaoer's $http.post
      const postResp = await client.post<{
        errCode?: number
        errMsg?: string
        data?: { feedId?: string; baseResp?: { errcode?: number; errmsg?: string } }
      }>(
        API.publish,
        postBody,
        { referer: 'https://channels.weixin.qq.com/platform/post/create', Origin: 'https://channels.weixin.qq.com', 'Content-Type': 'application/json' },
        { timeout: 30_000, responseType: 'json' }
      )

      const respData = postResp.data
      logger.info(`[wechat-channels] post_create response: ${JSON.stringify(respData).substring(0, 500)}`)

      // yixiaoer checks data.baseResp.errcode for post_create
      const errCode = respData?.errCode ?? respData?.data?.baseResp?.errcode ?? -1
      const errMsg = respData?.errMsg || respData?.data?.baseResp?.errmsg || '未知错误'

      if (errCode !== 0) {
        logger.error(`[wechat-channels] Submit failed: errCode=${errCode}, msg=${errMsg}`)
        throw new Error(`内容提交失败: ${errMsg} | errCode=${errCode} | finderId=${finderId} | finderUsername=${finderUsername} | draftId=${draftId} | clipKey=${clipKey} | url=${downloadUrl.substring(0, 80)}`)
      }

      const feedId = respData?.data?.feedId
      logger.info(`[wechat-channels] Content submitted successfully, feedId: ${feedId}`)
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

  /**
   * Upload cover image to CDN and return DownloadURL.
   * Matches yixiaoer's uploadCover$c flow.
   */
  private async uploadCoverImage(
    client: HttpClient,
    coverPath: string,
    authKey: string,
    uin: string,
    finderUsername: string
  ): Promise<string> {
    if (!existsSync(coverPath)) {
      logger.warn(`[wechat-channels] Cover file not found: ${coverPath}`)
      return ''
    }

    const { basename } = require('path')
    const https = require('https')
    const coverData = readFileSync(coverPath)

    if (coverData.length > 524288) {
      logger.warn(`[wechat-channels] Cover too large (${coverData.length} bytes, max 512KB)`)
      return ''
    }

    const fileName = basename(coverPath)
    const taskId = Date.now().toString()
    const IMAGE_FILE_TYPE = 20304

    // Step 1: Get upload ID for image
    const weixinnum = uin || (this.cachedFinderUin ? String(this.cachedFinderUin) : '') || ''
    const fileSize = coverData.length
    const blockPartLength = fileSize < 8388608 ? [fileSize] : [8388608, fileSize]
    const blockSum = blockPartLength.length

    const xArgs = `apptype=251&filetype=${IMAGE_FILE_TYPE}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=2`

    const uploadIdResp = await new Promise<any>((resolve, reject) => {
      const body = JSON.stringify({ BlockSum: blockSum, BlockPartLength: blockPartLength })
      const req = https.request({
        hostname: 'finderassistancea.video.qq.com',
        path: '/applyuploaddfs',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Arguments': xArgs,
          'Authorization': authKey,
          'Referer': 'https://channels.weixin.qq.com/',
          'Origin': 'https://channels.weixin.qq.com'
        },
        rejectUnauthorized: false
      }, (res: any) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
      })
      req.on('error', reject)
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Get upload ID timeout')) })
      req.write(body)
      req.end()
    })

    const uploadId = uploadIdResp?.UploadID
    if (!uploadId) {
      logger.warn(`[wechat-channels] Failed to get cover upload ID: ${JSON.stringify(uploadIdResp)}`)
      return ''
    }

    // Step 2: Upload image as single chunk
    const md5hash = createHash('md5').update(coverData).digest('hex')
    const uploadXArgs = `apptype=251&filetype=${IMAGE_FILE_TYPE}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=0`

    const etag = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'finderassistancea.video.qq.com',
        path: `/uploadpartdfs?PartNumber=1&UploadID=${encodeURIComponent(uploadId)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileSize,
          'Content-MD5': md5hash,
          'X-Arguments': uploadXArgs,
          'Authorization': authKey,
          'Referer': 'https://channels.weixin.qq.com/platform/post/create',
          'Origin': 'https://channels.weixin.qq.com'
        },
        rejectUnauthorized: false
      }, (res: any) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            resolve(json.ETag || '')
          } catch { resolve('') }
        })
      })
      req.on('error', reject)
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Cover upload timeout')) })
      req.write(coverData)
      req.end()
    })

    if (!etag) {
      logger.warn('[wechat-channels] Cover upload failed: no ETag')
      return ''
    }

    // Step 3: Complete upload to get DownloadURL
    const completeXArgs = `apptype=251&filetype=${IMAGE_FILE_TYPE}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=0`
    const completeBody = JSON.stringify({ TransFlag: '0_0', PartInfo: [{ PartNumber: 1, ETag: etag }] })

    const completeResp = await new Promise<any>((resolve, reject) => {
      const req = https.request({
        hostname: 'finderassistancea.video.qq.com',
        path: `/completepartuploaddfs?UploadID=${encodeURIComponent(uploadId)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(completeBody),
          'Content-MD5': 'null',
          'X-Arguments': completeXArgs,
          'Authorization': authKey,
          'Referer': 'https://channels.weixin.qq.com/',
          'Origin': 'https://channels.weixin.qq.com'
        },
        rejectUnauthorized: false
      }, (res: any) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({}) } })
      })
      req.on('error', reject)
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Complete cover upload timeout')) })
      req.write(completeBody)
      req.end()
    })

    const coverUrl = completeResp?.DownloadURL || ''
    if (coverUrl) {
      // Transform to finder.video.qq.com domain (matching yixiaoer)
      if (coverUrl.includes('qq.com')) {
        return 'https://finder.video.qq.com' + coverUrl.split('qq.com')[1]
      }
      return coverUrl
    }

    logger.warn(`[wechat-channels] Complete cover upload response: ${JSON.stringify(completeResp).substring(0, 300)}`)
    return ''
  }

  /**
   * Filter cookie string to only include WeChat-relevant cookies.
   * The CookieStore may contain cookies from all platforms; WeChat API
   * rejects requests with foreign cookies.
   * Also deduplicates by cookie name (keeps the last value for each name).
   */
  private filterWechatCookies(cookie: string): string {
    const wechatCookieNames = ['sessionid', 'wxuin', 'finder_id', 'pass_ticket', 'skey',
      'slave_sid', 'sessionid_ss', 'uin', 'websid']
    // Use a Map to deduplicate — last value wins
    const cookieMap = new Map<string, string>()
    for (const part of cookie.split(';')) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx < 0) continue
      const name = trimmed.substring(0, eqIdx).trim()
      const value = trimmed.substring(eqIdx + 1).trim()
      if (wechatCookieNames.includes(name)) {
        cookieMap.set(name, value)
      }
    }
    return Array.from(cookieMap.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /**
   * Get recommended POI locations on WeChat Channels.
   * Uses the finder POI search endpoint without keyword.
   * Matching yixiaoer's getLocationListResponse$3 + getShipinhaoLocation.
   */
  async getRecommendLocations(client: HttpClient, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const rawCookie = client.getCookieString()
      // Filter to only WeChat cookies — the API rejects requests with foreign cookies
      const cookie = this.filterWechatCookies(rawCookie)
      const finderId = this.extractFinderId(rawCookie) || this.cachedFinderUsername || ''

      logger.info(`[wechat-channels] getRecommendLocations called with finderId: ${finderId}, options:`, options)
      logger.info(`[wechat-channels] Filtered cookies: "${cookie}"`)

      // Try the location API directly — don't call checkSessionAPI first
      // (checkSessionAPI uses auth_data which may return 300330 even when location API works)
      const body = {
        query: '',
        cookies: '',
        longitude: 0,
        latitude: 0,
        timestamp: getTimestamp13(),
        _log_finder_uin: '',
        _log_finder_id: finderId,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }

      logger.info(`[wechat-channels] POI recommend request body:`, body)

      // Use postMinimal to avoid extra browser-like headers (Accept-Encoding, sec-ch-ua, etc.)
      // yixiaoer only sends cookie + referer for this endpoint
      const response = await client.postMinimal<{
        errCode?: number
        errMsg?: string
        data?: {
          address?: {
            city?: string
            province?: string
            poiCheckSum?: string
          }
          list?: Array<{
            uid?: string
            name?: string
            address?: string
            longitude?: number
            latitude?: number
            city?: string
            region?: string
            fullAddress?: string
            poiCheckSum?: string
          }>
        }
      }>(
        'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_search_location',
        body,
        {
          referer: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json',
          Cookie: cookie
        },
        { timeout: 15_000, responseType: 'json' }
      )

      const errCode = response.data?.errCode ?? -1
      logger.info(`[wechat-channels] POI recommend response: errCode=${errCode}, msg=${response.data?.errMsg}, listCount=${response.data?.data?.list?.length || 0}`)

      if (errCode !== 0) {
        if (errCode === 300330 || errCode === 300333) {
          logger.warn(`[wechat-channels] Session invalid (errCode=${errCode}), please re-login`)
        }
        logger.warn(`[wechat-channels] Location recommend failed: errCode=${errCode}, msg=${response.data?.errMsg}`)
        return []
      }

      const results: import('../IPlatformAdapter').LocationResult[] = []

      // yixiaoer also adds the default address as a location option (when no query)
      const addressData = response.data?.data?.address
      if (addressData?.poiCheckSum) {
        results.push({
          id: addressData.poiCheckSum,
          name: addressData.city || '',
          address: (addressData.province || '') + (addressData.city || ''),
          lat: undefined,
          lng: undefined,
          poi_id: addressData.poiCheckSum,
          extra: { city: addressData.city, region: addressData.province, checkSum: addressData.poiCheckSum }
        })
      } else if (options?.city) {
        // Fallback: add city-level option from IP location
        results.push({
          id: `city_${options.city}`,
          name: options.city,
          address: options.city,
          lat: options.lat,
          lng: options.lng,
          poi_id: `city_${options.city}`,
          extra: { city: options.city, isCityLevel: true }
        })
      }

      // Add all list items
      const list = response.data?.data?.list || []
      for (const poi of list) {
        results.push({
          id: poi.uid || '',
          name: poi.name || '',
          address: poi.fullAddress || poi.address || poi.city || '',
          lat: poi.latitude,
          lng: poi.longitude,
          poi_id: poi.uid,
          extra: { city: poi.city, region: poi.region, checkSum: poi.poiCheckSum }
        })
      }

      return results
    } catch (err) {
      logger.error('[wechat-channels] getRecommendLocations error:', err)
      return []
    }
  }

  /**
   * Search POI locations on WeChat Channels.
   * Uses the same endpoint as recommend (matching yixiaoer's getLocationListResponse$3).
   */
  async searchLocation(client: HttpClient, keyword: string, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const rawCookie = client.getCookieString()
      const cookie = this.filterWechatCookies(rawCookie)
      const finderId = this.extractFinderId(rawCookie) || this.cachedFinderUsername || ''

      // Use the same endpoint and body format as recommend (matching yixiaoer)
      const body = {
        query: keyword,
        cookies: '',
        longitude: 0,
        latitude: 0,
        timestamp: getTimestamp13(),
        _log_finder_uin: '',
        _log_finder_id: finderId,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }

      const response = await client.postMinimal<{
        errCode?: number
        errMsg?: string
        data?: {
          list?: Array<{
            uid?: string
            name?: string
            address?: string
            longitude?: number
            latitude?: number
            city?: string
            region?: string
            fullAddress?: string
            poiCheckSum?: string
          }>
        }
      }>(
        'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_search_location',
        body,
        {
          referer: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json',
          Cookie: cookie
        },
        { timeout: 15_000, responseType: 'json' }
      )

      const errCode = response.data?.errCode ?? -1
      logger.info(`[wechat-channels] POI search response: errCode=${errCode}, listCount=${response.data?.data?.list?.length || 0}`)

      if (errCode !== 0 || !response.data?.data?.list) {
        logger.warn(`[wechat-channels] Location search failed: errCode=${errCode}, msg=${response.data?.errMsg}`)
        return []
      }

      return response.data.data.list.map((poi) => ({
        id: poi.uid || '',
        name: poi.name || '',
        address: poi.fullAddress || poi.address || poi.city || '',
        lat: poi.latitude,
        lng: poi.longitude,
        poi_id: poi.uid,
        extra: { city: poi.city, region: poi.region, checkSum: poi.poiCheckSum }
      }))
    } catch (err) {
      logger.error('[wechat-channels] searchLocation error:', err)
      return []
    }
  }

  /**
   * Fetch user's collection (合集) list from WeChat Channels.
   * Actual endpoint: /micro/content/cgi-bin/mmfinderassistant-bin/collection/get_collection_list
   */
  async getCollections(client: HttpClient): Promise<Array<{ label: string; value: string }>> {
    try {
      const response = await client.post<{
        errCode?: number
        data?: {
          collectionList?: Array<{
            id?: string
            name?: string
            feedCount?: number
            desc?: string
          }>
        }
      }>(
        'https://channels.weixin.qq.com/micro/content/cgi-bin/mmfinderassistant-bin/collection/get_collection_list',
        {},
        {
          referer: 'https://channels.weixin.qq.com/platform/post/create',
          Origin: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json'
        },
        { timeout: 15_000, responseType: 'json' }
      )

      const errCode = response.data?.errCode ?? -1
      if (errCode !== 0 || !response.data?.data?.collectionList) {
        logger.warn(`[wechat-channels] get_collection_list failed: errCode=${errCode}`)
        return []
      }

      return response.data.data.collectionList
        .filter((c) => c.id && c.name)
        .map((c) => ({
          label: `${c.name} (${c.feedCount || 0}个内容)`,
          value: c.id!
        }))
    } catch (err) {
      logger.error('[wechat-channels] getCollections error:', err)
      return []
    }
  }
}
