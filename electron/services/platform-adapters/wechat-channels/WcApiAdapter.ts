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

// WeChat Channels API endpoints (reverse-engineered from yixiaoer)
const API = {
  authData: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
  uploadParams: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params',
  publish: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_create'
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
  private lastUploadResult: { downloadUrl: string; uploadId: string; fileSize: number; fileName: string } | null = null

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
    this.lastUploadResult = {
      downloadUrl: downloadUrl || '',
      uploadId,
      fileSize: stats.size,
      fileName: require('path').basename(filePath)
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
    const CHUNK_SIZE = 8388608 // 8MB
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69'
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
   * Upload video file to CDN in 8MB chunks using native https module.
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
  ): Promise<void> {
    const https = require('https')
    const CHUNK_SIZE = 8 * 1024 * 1024
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
    const fileBuffer = readFileSync(filePath)
    const weixinnum = uin || (this.cachedFinderUin ? String(this.cachedFinderUin) : '') || ''
    const taskId = Date.now().toString()
    const fileName = require('path').basename(filePath)

    const partInfoMap = new Map<number, { PartNumber: number; ETag: string }>()

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, fileSize)
      const chunk = fileBuffer.subarray(start, end)
      const contentMd5 = createHash('md5').update(chunk).digest('hex')
      const partNumber = i + 1

      // Get fresh authKey for each chunk
      let chunkAuthKey = authKey
      try {
        const freshParams = await client.post<{
          errCode: number
          data?: { authKey?: string }
        }>(
          API.uploadParams,
          { timestamp: getTimestamp13(), _log_finder_id: '', rawKeyBuff: null },
          { referer: 'https://channels.weixin.qq.com/platform/post/create', Accept: 'application/json, text/plain, */*' }
        )
        if (freshParams.data?.errCode === 0 && freshParams.data?.data?.authKey) {
          chunkAuthKey = freshParams.data.data.authKey
          logger.info(`[wechat-channels] Got fresh authKey for chunk ${partNumber}`)
        }
      } catch {
        // Use original authKey as fallback
      }

      const xArgs = `apptype=251&filetype=${fileType}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=0`
      const uploadUrl = `/uploadpartdfs?PartNumber=${partNumber}&UploadID=${encodeURIComponent(uploadId)}`

      logger.info(`[wechat-channels] Chunk ${partNumber}/${totalChunks}: size=${chunk.length}, url=${uploadUrl}`)

      const result = await new Promise<{ ETag: string }>((resolve, reject) => {
        const req = https.request({
          hostname: 'finderassistancea.video.qq.com',
          port: 443,
          path: uploadUrl,
          method: 'PUT',
          rejectUnauthorized: false,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': chunk.length,
            'Content-MD5': contentMd5,
            'X-Arguments': xArgs,
            'Authorization': chunkAuthKey,
            'Referer': 'https://channels.weixin.qq.com/platform/post/create',
            'Origin': 'https://channels.weixin.qq.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69',
            'Accept': 'application/json, text/plain, */*'
          }
        }, (res: any) => {
          let data = ''
          res.on('data', (c: Buffer) => { data += c.toString() })
          res.on('end', () => {
            logger.info(`[wechat-channels] Chunk ${partNumber}/${totalChunks} response: status=${res.statusCode}, data=${data.substring(0, 300)}`)
            try {
              const json = JSON.parse(data)
              if (json.ETag) {
                resolve(json)
              } else {
                reject(new Error(`Chunk ${partNumber} failed: status=${res.statusCode}, data=${data}`))
              }
            } catch {
              // Retry once if response is not JSON (matching yixiaoer retry behavior)
              logger.warn(`[wechat-channels] Chunk ${partNumber} non-JSON response, retrying...`)
              const retryReq = https.request({
                hostname: 'finderassistancea.video.qq.com',
                port: 443,
                path: uploadUrl,
                method: 'PUT',
                rejectUnauthorized: false,
                headers: {
                  'Content-Type': 'application/octet-stream',
                  'Content-Length': chunk.length,
                  'Content-MD5': contentMd5,
                  'X-Arguments': xArgs,
                  'Authorization': chunkAuthKey,
                  'Referer': 'https://channels.weixin.qq.com/platform/post/create',
                  'Origin': 'https://channels.weixin.qq.com',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69',
                  'Accept': 'application/json, text/plain, */*'
                }
              }, (res2: any) => {
                let data2 = ''
                res2.on('data', (c: Buffer) => { data2 += c.toString() })
                res2.on('end', () => {
                  logger.info(`[wechat-channels] Chunk ${partNumber} retry response: status=${res2.statusCode}, data=${data2.substring(0, 300)}`)
                  try {
                    const json2 = JSON.parse(data2)
                    if (json2.ETag) resolve(json2)
                    else reject(new Error(`Chunk ${partNumber} retry failed: ${data2}`))
                  } catch {
                    reject(new Error(`Chunk ${partNumber} retry parse error: ${data2}`))
                  }
                })
              })
              retryReq.on('error', reject)
              retryReq.setTimeout(200_000, () => { retryReq.destroy(); reject(new Error(`Chunk ${partNumber} retry timeout`)) })
              retryReq.write(chunk)
              retryReq.end()
            }
          })
        })
        req.on('error', reject)
        req.setTimeout(200_000, () => { req.destroy(); reject(new Error(`Chunk ${partNumber} timeout`)) })
        req.write(chunk)
        req.end()
      })

      partInfoMap.set(partNumber, { PartNumber: partNumber, ETag: result.ETag })
      logger.info(`[wechat-channels] Chunk ${partNumber}/${totalChunks} uploaded, ETag: ${result.ETag}`)

      const percent = 10 + Math.round((partNumber / totalChunks) * 70)
      onProgress?.({ percent, stage: `上传中 ${partNumber}/${totalChunks}` })
    }

    // Complete upload
    const partInfoArray = Array.from(partInfoMap.values())
    const completeBody = JSON.stringify({
      TransFlag: '0_0',
      PartInfo: partInfoArray
    })

    const completeXArgs = `apptype=251&filetype=${fileType}&weixinnum=${weixinnum}&filekey=${encodeURIComponent(fileName)}&filesize=${fileSize}&taskid=${taskId}&scene=2`
    const completePath = `/completepartuploaddfs?UploadID=${encodeURIComponent(uploadId)}`

    const downloadUrl = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'finderassistancea.video.qq.com',
        port: 443,
        path: completePath,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(completeBody),
          'Content-MD5': 'null',
          'X-Arguments': completeXArgs,
          'Authorization': authKey,
          'Referer': 'https://channels.weixin.qq.com/',
          'Origin': 'https://channels.weixin.qq.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.69'
        }
      }, (res: any) => {
        let data = ''
        res.on('data', (c: Buffer) => { data += c.toString() })
        res.on('end', () => {
          logger.info(`[wechat-channels] Complete upload response: status=${res.statusCode}, data=${data.substring(0, 300)}`)
          try {
            const json = JSON.parse(data)
            if (json.errCode && json.errCode !== 0) {
              reject(new Error(`Complete upload failed: ${json.errMsg}`))
            } else {
              resolve(json.DownloadURL || '')
            }
          } catch {
            resolve('') // CDN may return non-JSON on success
          }
        })
      })
      req.on('error', reject)
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Complete upload timeout')) })
      req.write(completeBody)
      req.end()
    })

    logger.info(`[wechat-channels] Upload completed, parts: ${partInfoArray.length}`)
    return downloadUrl
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const cookie = client.getCookieString()
    const finderId = this.extractFinderId(cookie)

    // Build description with hashtags inline
    let desc = payload.title || ''
    if (payload.description) {
      desc += '\n' + payload.description
    }

    // Build location
    let location: Record<string, unknown> = {}
    if (payload.platformFields?.location) {
      location = { poiName: String(payload.platformFields.location) }
    }

    // Use upload result data for media info
    const uploadResult = this.lastUploadResult
    const downloadUrl = uploadResult?.downloadUrl || ''
    const fileSize = uploadResult?.fileSize || 0

    // Step 1: Call post_clip_video (saveTmpPostDraft) to get draftId — REQUIRED by the API
    let draftId = uploadResult?.uploadId || videoId || ''
    try {
      const clipBody = {
        url: downloadUrl,
        timeStart: 0,
        cropDuration: 0,
        height: 0,
        width: 0,
        x: 0,
        y: 0,
        clipOriginVideoInfo: { width: 0, height: 0, duration: 10, fileSize },
        traceInfo: {
          traceKey: `FPT_${Date.now().toString().substring(0, 10)}_1378746213`,
          uploadCdnStart: Date.now().toString().substring(0, 10),
          uploadCdnEnd: Date.now().toString().substring(0, 10)
        },
        targetWidth: 0,
        targetHeight: 0,
        type: 4,
        timestamp: getTimestamp13().toString(),
        _log_finder_uin: null,
        _log_finder_id: finderId || null,
        rawKeyBuff: null,
        pluginSessionId: null,
        scene: 7,
        reqScene: 7
      }
      const clipResp = await client.post<{
        errCode?: number
        data?: { videoClipTaskId?: string }
      }>(
        'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/post/post_clip_video',
        clipBody,
        { referer: 'https://channels.weixin.qq.com/platform/post/create' }
      )
      if (clipResp.data?.data?.videoClipTaskId) {
        draftId = clipResp.data.data.videoClipTaskId
        logger.info(`[wechat-channels] post_clip_video success, draftId: ${draftId}`)
      } else {
        logger.warn(`[wechat-channels] post_clip_video response: ${JSON.stringify(clipResp.data).substring(0, 300)}`)
      }
    } catch (e) {
      logger.warn(`[wechat-channels] post_clip_video failed, using uploadId as draftId: ${e}`)
    }

    // Build topics array (string names, matching yixiaoer)
    const topics: string[] = payload.hashtags || []

    // Build the postReq body matching yixiaoer's buildPostData$M output
    const postReq: Record<string, unknown> = {
      longitude: 0,
      latitude: 0,
      feedLongitude: 0,
      feedLatitude: 0,
      originalFlag: payload.declarations.includes('声明原创') ? 1 : 0,
      objectType: 0,
      postFlag: 0,
      isFullPost: 1,
      handleFlag: 1,
      topics,
      objectDesc: {
        description: desc,
        event: {},
        extReading: { link: '', title: '' },
        mediaType: 4,
        location,
        topic: { finderTopicInfo: '' },
        mentionedUser: [],
        mpTitle: '',
        media: [{
          coverUrl: '',
          fileSize,
          fullCoverUrl: '',
          fullThumbUrl: '',
          height: 0,
          md5sum: '',
          mediaType: 4,
          shareCoverUrl: '',
          url: downloadUrl,
          thumbUrl: '',
          urlCdnTaskId: draftId,
          videoPlayLen: 10,
          width: 0
        }],
        shortTitle: []
      },
      report: {
        _log_finder_id: finderId || '',
        clipKey: '',
        draftId,
        height: 1920,
        width: 1280,
        pluginSessionId: null,
        rawKeyBuff: '',
        scene: 7,
        reqScene: 7,
        timestamp: getTimestamp13(),
        duration: 10,
        fileSize,
        uploadCost: Math.ceil((fileSize || 1024 * 1024) / 524287) * 1000
      },
      clientid: Date.now().toString(),
      timestamp: getTimestamp13(),
      _log_finder_id: finderId || '',
      scene: 7,
      reqScene: 7,
      videoClipTaskId: draftId
    }

    // Wrap in postReq envelope for pubType=0 (standard publish)
    const postData: Record<string, unknown> = {
      _log_finder_id: finderId || '',
      objectId: null,
      pluginSessionId: null,
      postReq,
      rawKeyBuff: '',
      scene: 7,
      reqScene: 7,
      timestamp: getTimestamp13()
    }

    logger.info(`[wechat-channels] Submit body: ${JSON.stringify(postData).substring(0, 2000)}`)

    try {
      const response = await client.post<{
        errCode: number
        errMsg?: string
        data?: { feedId: string }
      }>(
        API.publish,
        postData,
        {
          referer: 'https://channels.weixin.qq.com/platform/post/create',
          Origin: 'https://channels.weixin.qq.com',
          'Content-Type': 'application/json'
        }
      )

      if (response.data?.errCode !== 0) {
        const errMsg = response.data?.errMsg || '未知错误'
        logger.error(`[wechat-channels] Submit failed: errCode=${response.data?.errCode}, msg=${errMsg}`)
        throw new Error(`内容提交失败: ${errMsg}`)
      }

      logger.info(`[wechat-channels] Content submitted successfully, feedId: ${response.data?.data?.feedId}`)
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
