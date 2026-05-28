import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints } from '../IPlatformAdapter'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../../http/HttpClient'
import { KS_URLS } from './ks-urls'
import { KS_SELECTORS } from './ks-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { ffmpegService } from '../../ffmpeg/FFmpegService'

// Kuaishou Creator API endpoints (reverse-engineered from browser)
const API = {
  userInfo: 'https://cp.kuaishou.com/rest/cp/creator/pc/home/infoV2',
  uploadPre: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/pre',
  uploadFinish: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/upload/finish',
  materialSpecified: 'https://cp.kuaishou.com/rest/cp/works/v4/video/pc/upload/material/specified',
  submit: 'https://cp.kuaishou.com/rest/cp/works/v2/video/pc/submit'
}

const REFERER = 'https://cp.kuaishou.com/article/publish/video'
const ORIGIN = 'https://cp.kuaishou.com'
const CHUNK_SIZE = 4 * 1024 * 1024 // 4MB — matching browser's fragment size

export class KsApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'kuaishou'
  readonly platformName = '快手'
  readonly loginUrl = KS_URLS.login

  // Cached account info from userInfo API
  private cachedDisplayName: string = ''
  private cachedUserId: string = ''

  // Last upload result for submitContentAPI
  private lastUploadResult: {
    photoId: string
    fileId: number
    token: string
    fileSize: number
    videoWidth: number
    videoHeight: number
    videoDuration: number
    md5sum: string
  } | null = null

  private loginCheckCount = 0

  getVideoConstraints(): VideoConstraints {
    return {
      maxFileSizeMB: 500,
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

  // --- Browser mode (login) ---

  async startLogin(context: BrowserContext): Promise<Page> {
    this.loginCheckCount = 0
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)

    logger.info(`[kuaishou] Navigating to ${this.loginUrl}...`)
    page.goto(this.loginUrl, { waitUntil: 'commit', timeout: 30_000 }).catch((err) => {
      logger.warn(`[kuaishou] Navigation error (non-fatal): ${err.message}`)
    })

    await delay(3000)
    logger.info(`[kuaishou] Browser page created, current URL: ${page.url()}`)

    // Kuaishou requires clicking a login button before QR code appears
    try {
      const loginBtn = await page.$(KS_SELECTORS.loginBtn)
      if (loginBtn) {
        logger.info('[kuaishou] Found login button, clicking...')
        await loginBtn.click()
        await delay(2000)
      } else {
        const altBtn = await page.$('text=登录') || await page.$('[class*="login"]')
        if (altBtn) {
          logger.info('[kuaishou] Found login element (alt), clicking...')
          await altBtn.click()
          await delay(2000)
        } else {
          logger.info('[kuaishou] No login button found — page may already show QR or be logged in')
        }
      }
    } catch (e) {
      logger.warn(`[kuaishou] Login button click failed: ${e}`)
    }

    return page
  }

  async waitForQRCode(page: Page): Promise<string | null> {
    logger.info('[kuaishou] Waiting for QR code...')
    for (let i = 0; i < 40; i++) {
      try {
        const url = page.url()
        if (i % 10 === 0) {
          logger.info(`[kuaishou] QR check #${i}, URL: ${url}`)
        }

        if (url === 'about:blank' || !url.includes('kuaishou')) {
          await delay(1000)
          continue
        }

        const qrEl = await page.$(KS_SELECTORS.qrCode)
        if (qrEl) {
          const screenshot = await qrEl.screenshot()
          logger.info('[kuaishou] QR code captured')
          return `data:image/png;base64,${screenshot.toString('base64')}`
        }
      } catch {}
      await delay(1000)
    }
    logger.warn('[kuaishou] QR code not found after 40s — check network/VPN')
    return null
  }

  protected async detectLoginSuccess(page: Page): Promise<boolean> {
    try {
      this.loginCheckCount++

      if (this.loginCheckCount < 10) return false

      const url = page.url()

      // CDP cookie check — only real auth cookies indicate login
      let hasAuthCookie = false
      let ksCookieCount = 0
      try {
        const client = await page.context().newCDPSession(page)
        const { cookies } = await client.send('Network.getAllCookies')
        await client.detach()

        const ksCookies = cookies.filter((c: any) =>
          c.domain.includes('kuaishou') || c.domain.includes('ksapisvr')
        )
        ksCookieCount = ksCookies.length

        const authNames = ['userId', 'kuaishou.web.cp.api_ph', 'sid']
        hasAuthCookie = ksCookies.some((c: any) => authNames.includes(c.name) && c.value)

        if (this.loginCheckCount % 10 === 0) {
          logger.info(`[kuaishou] CDP cookies: ${ksCookies.length} ks | names: ${ksCookies.map((c: any) => c.name).join(', ')} | url: ${url}`)
        }
      } catch (e) {
        if (this.loginCheckCount % 20 === 0) {
          logger.warn('[kuaishou] CDP cookie check failed:', e)
        }
      }

      const urlChanged = url.includes('cp.kuaishou.com/article') || url.includes('cp.kuaishou.com/home')

      if (urlChanged && hasAuthCookie) {
        logger.info(`[kuaishou] Login detected (URL + auth cookie)`)
        return true
      }

      if (hasAuthCookie) {
        logger.info(`[kuaishou] Login detected (auth cookie: userId/api_ph/sid found)`)
        return true
      }

      if (urlChanged && ksCookieCount >= 5) {
        logger.info(`[kuaishou] Login detected (URL + ${ksCookieCount} cookies)`)
        return true
      }

      return false
    } catch {
      return false
    }
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

  // --- API mode ---

  async getAccountInfoAPI(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null> {
    try {
      const cookie = client.getCookieString()
      const apiPh = this.extractApiPh(cookie)

      const response = await client.post<{
        result: number
        data?: {
          user_name?: string
          user_avatar?: string
          user_id?: string
        }
      }>(
        API.userInfo,
        JSON.stringify({ 'kuaishou.web.cp.api_ph': apiPh }),
        { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
      )

      if (response.data?.result === 1 && response.data?.data) {
        const data = response.data.data
        this.cachedDisplayName = data.user_name || ''
        this.cachedUserId = data.user_id || ''
        logger.info(`[kuaishou] getAccountInfoAPI: name=${data.user_name}, userId=${data.user_id}`)
        return {
          displayName: data.user_name || undefined,
          avatarUrl: data.user_avatar || undefined
        }
      }

      return null
    } catch (err) {
      logger.error('[kuaishou] getAccountInfoAPI error:', err)
      return null
    }
  }

  async checkSessionAPI(client: HttpClient): Promise<boolean> {
    try {
      const cookie = client.getCookieString()
      const apiPh = this.extractApiPh(cookie)

      const response = await client.post<{ result: number; data?: { user_name: string; user_id?: string } }>(
        API.userInfo,
        JSON.stringify({ 'kuaishou.web.cp.api_ph': apiPh }),
        { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
      )

      if (response.data?.result === 1 && response.data?.data) {
        this.cachedDisplayName = response.data.data.user_name || ''
        this.cachedUserId = response.data.data.user_id || ''
        logger.info(`[kuaishou] Session valid, user: ${this.cachedDisplayName}, userId: ${this.cachedUserId}`)
        return true
      }

      logger.warn(`[kuaishou] Session invalid: result=${response.data?.result}`)
      return false
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

    // Probe video metadata
    let videoWidth = 0, videoHeight = 0, videoDuration = 0
    try {
      const probe = await ffmpegService.probeVideo(filePath)
      videoWidth = probe.width || 0
      videoHeight = probe.height || 0
      videoDuration = Math.round(probe.duration || 0)
      logger.info(`[kuaishou] Video probed: ${videoWidth}x${videoHeight}, duration=${videoDuration}s`)
    } catch (e) {
      logger.warn(`[kuaishou] Video probe failed, using defaults: ${e}`)
    }

    const md5sum = await this.computeFileMd5(filePath)
    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    onProgress?.({ percent: 5, stage: '正在获取上传凭证...' })

    // Step 1: Get upload token — uploadType: 1 (numeric, not string!)
    const preBody = JSON.stringify({ uploadType: 1, 'kuaishou.web.cp.api_ph': apiPh })

    let preData: { token?: string; photoId?: string } | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const preResponse = await client.post<{
          result: number
          currentTime?: number
          data?: { token?: string; photoId?: string }
          error_msg?: string
          message?: string
        }>(
          API.uploadPre,
          preBody,
          { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
        )

        logger.info(`[kuaishou] Upload pre response: ${JSON.stringify(preResponse.data).substring(0, 500)}`)

        if (preResponse.data?.result === 1 && preResponse.data?.data?.token) {
          preData = preResponse.data.data
          break
        }

        logger.warn(`[kuaishou] Upload pre attempt ${attempt + 1} failed: ${JSON.stringify(preResponse.data).substring(0, 300)}`)
      } catch (err) {
        logger.warn(`[kuaishou] Upload pre attempt ${attempt + 1} error:`, err)
      }

      if (attempt < 2) await delay(1000 * (attempt + 1))
    }

    if (!preData?.token) {
      throw new Error('获取上传凭证失败，请检查登录状态')
    }

    const { token } = preData
    logger.info(`[kuaishou] Upload token obtained: ${token.substring(0, 30)}...`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Upload fragments (4MB each, matching browser behavior)
    const fileBuffer = readFileSync(filePath)
    const totalChunks = Math.ceil(stats.size / CHUNK_SIZE)
    const https = require('https')
    const agent = new https.Agent({ keepAlive: true, maxSockets: 3, rejectUnauthorized: false })

    let completedChunks = 0
    const uploadHost = 'upload.kuaishouzt.com'

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, stats.size)
      const chunk = fileBuffer.subarray(start, end)

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = https.request({
              hostname: uploadHost,
              port: 443,
              path: `/api/upload/fragment?upload_token=${encodeURIComponent(token)}&fragment_id=${i}`,
              method: 'POST',
              agent,
              headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': chunk.length,
                'Referer': REFERER,
                'Origin': ORIGIN
              }
            }, (res: any) => {
              let data = ''
              res.on('data', (c: Buffer) => { data += c.toString() })
              res.on('end', () => {
                if (res.statusCode === 200) {
                  try {
                    const json = JSON.parse(data)
                    if (json.result === 1) {
                      resolve()
                    } else {
                      reject(new Error(`Fragment ${i} failed: ${data.substring(0, 200)}`))
                    }
                  } catch {
                    reject(new Error(`Fragment ${i} non-JSON: ${data.substring(0, 200)}`))
                  }
                } else {
                  reject(new Error(`Fragment ${i} HTTP ${res.statusCode}: ${data.substring(0, 200)}`))
                }
              })
            })
            req.on('error', reject)
            req.setTimeout(120_000, () => { req.destroy(); reject(new Error(`Fragment ${i} timeout`)) })
            req.write(chunk)
            req.end()
          })

          completedChunks++
          onProgress?.({ percent: 10 + Math.round((completedChunks / totalChunks) * 65), stage: `上传中 ${completedChunks}/${totalChunks}` })
          break // success
        } catch (err: any) {
          if (attempt < 2) {
            logger.warn(`[kuaishou] Fragment ${i} attempt ${attempt + 1} failed: ${err.message}, retrying...`)
            await delay(1000 * (attempt + 1))
          } else {
            throw new Error(`视频分片上传失败 (fragment ${i}): ${err.message}`)
          }
        }
      }
    }

    agent.destroy()
    logger.info(`[kuaishou] All ${totalChunks} fragments uploaded`)

    onProgress?.({ percent: 80, stage: '正在完成上传...' })

    // Step 3: Finish upload
    const finishBody = JSON.stringify({ token, 'kuaishou.web.cp.api_ph': apiPh })
    const finishResponse = await client.post<{
      result: number
      data?: { fileId?: number; photoId?: string }
    }>(
      API.uploadFinish,
      finishBody,
      { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
    )

    logger.info(`[kuaishou] Upload finish response: ${JSON.stringify(finishResponse.data).substring(0, 500)}`)

    const fileId = finishResponse.data?.data?.fileId
    const photoId = finishResponse.data?.data?.photoId || ''

    // Store for submitContentAPI
    this.lastUploadResult = {
      photoId,
      fileId: fileId || 0,
      token,
      fileSize: stats.size,
      videoWidth,
      videoHeight,
      videoDuration,
      md5sum
    }

    logger.info(`[kuaishou] Video uploaded, fileId: ${fileId}, photoId: ${photoId}`)
    onProgress?.({ percent: 90, stage: '视频上传完成' })

    return String(fileId || photoId || token)
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void> {
    const uploadResult = this.lastUploadResult
    const fileId = uploadResult?.fileId || Number(videoId) || 0

    if (!fileId) {
      throw new Error('缺少视频ID (fileId)，请先上传视频')
    }

    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    // Build caption with hashtags
    let caption = payload.title || ''
    if (payload.description) {
      caption += ' ' + payload.description
    }
    // Append hashtags in the format: #tag1 #tag2
    const topics = payload.hashtags || []
    for (const tag of topics) {
      caption += ` #${tag} `
    }

    // Platform-specific fields
    let privacyType = 0
    if (payload.platformFields?.localVisible) {
      privacyType = 1
    }

    const videoWidth = uploadResult?.videoWidth || 1920
    const videoHeight = uploadResult?.videoHeight || 1080
    const videoDuration = uploadResult?.videoDuration || 0

    const params: Record<string, unknown> = {
      fileId,
      coverKey: '',
      coverTimeStamp: 0,
      caption: caption.trim(),
      photoStatus: 1,
      coverType: 1,
      coverTitle: '',
      photoType: 0,
      collectionId: '',
      publishTime: 0,
      longitude: '',
      latitude: '',
      poiId: 0,
      notifyResult: 0,
      domain: '',
      secondDomain: '',
      coverUrl: '',
      'kuaishou.web.cp.api_ph': apiPh
    }

    logger.info(`[kuaishou] Submitting: fileId=${fileId}, caption=${caption.substring(0, 80)}`)

    const response = await client.post<{
      result: number
      data?: { photoId?: string }
      error_msg?: string
      message?: string
    }>(
      API.submit,
      JSON.stringify(params),
      { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
    )

    logger.info(`[kuaishou] Submit response: ${JSON.stringify(response.data).substring(0, 500)}`)

    if (response.data?.result !== 1) {
      const errMsg = response.data?.error_msg || response.data?.message || '未知错误'
      throw new Error(`内容提交失败: ${errMsg} (result=${response.data?.result})`)
    }

    logger.info(`[kuaishou] Content submitted successfully`)
  }

  private extractApiPh(cookie: string): string {
    const match = cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/)
    return match ? match[1] : ''
  }

  private async computeFileMd5(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('md5')
      const { createReadStream } = require('fs')
      const stream = createReadStream(filePath)
      stream.on('data', (data: Buffer) => hash.update(data))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }
}
