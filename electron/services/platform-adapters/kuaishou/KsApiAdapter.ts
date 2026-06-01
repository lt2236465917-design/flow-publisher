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
import { getSignService } from '../../sign/SignService'

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
    mediaId: string
    coverMediaId: string
    coverKey: string
    videoFrameRate: number
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
        name: 'location',
        type: 'location',
        label: '添加地点',
        placeholder: '请选择所在地区'
      },
      {
        name: 'authorDeclaration',
        type: 'select',
        label: '内容声明',
        placeholder: '选择内容声明（可选）',
        options: [
          { label: '无', value: '0' },
          { label: '内容为AI生成', value: '1' },
          { label: '演绎情节，仅供娱乐', value: '2' },
          { label: '个人观点，仅供参考', value: '3' },
          { label: '素材来源于网络', value: '4' }
        ]
      },
      {
        name: 'interactionSettings',
        type: 'checkbox-group',
        label: '互动设置',
        options: [
          { label: '允许别人跟我拍同框', value: 'allowSameFrame' },
          { label: '允许下载此作品', value: 'allowDownload' },
          { label: '作品展示在同城页', value: 'showInLocal' }
        ],
        defaultValue: ['allowSameFrame', 'allowDownload', 'showInLocal']
      },
      {
        name: 'viewPermission',
        type: 'checkbox-group',
        label: '查看权限',
        options: [
          { label: '所有人可见', value: 'public' },
          { label: '好友可见', value: 'friends' },
          { label: '仅自己可见', value: 'private' }
        ],
        maxSelections: 1,
        defaultValue: ['public']
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
      logger.info(`[kuaishou] getAccountInfoAPI called, cookie length: ${cookie.length}, apiPh: ${apiPh ? 'yes' : 'no'}`)

      const body = JSON.stringify({ 'kuaishou.web.cp.api_ph': apiPh })

      // 直接调用 API，不使用签名
      const response = await client.post<{
        result: number
        data?: {
          user_name?: string
          user_avatar?: string
          user_id?: string
        }
        error_msg?: string
        message?: string
      }>(
        API.userInfo,
        body,
        { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
      )

      logger.info(`[kuaishou] getAccountInfoAPI response: ${JSON.stringify(response.data).substring(0, 500)}`)

      if (response.data?.result === 1 && response.data?.data) {
        const data = response.data.data
        this.cachedDisplayName = data.user_name || ''
        this.cachedUserId = data.user_id || ''
        logger.info(`[kuaishou] getAccountInfoAPI success: name=${data.user_name}, userId=${data.user_id}`)
        return {
          displayName: data.user_name || undefined,
          avatarUrl: data.user_avatar || undefined
        }
      }

      logger.warn(`[kuaishou] getAccountInfoAPI failed: result=${response.data?.result}, message=${response.data?.message}`)
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

        logger.info(`[kuaishou] Upload pre response: ${JSON.stringify(preResponse.data)}`)

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

    const { token, photoId: prePhotoId } = preData
    logger.info(`[kuaishou] Upload token obtained: ${token.substring(0, 30)}..., photoId: ${prePhotoId || 'N/A'}`)

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

    logger.info(`[kuaishou] All ${totalChunks} fragments uploaded`)

    onProgress?.({ percent: 80, stage: '正在完成上传...' })

    // Step 3a: CDN-level complete — tells the upload server to reassemble fragments
    // This MUST succeed before upload/finish can work — make it fatal with retries
    const completeBody = JSON.stringify({ upload_token: token, fragment_count: totalChunks })
    logger.info(`[kuaishou] Calling CDN upload/complete (POST) with ${totalChunks} fragments`)

    let cdnCompleteOk = false
    for (let cdnAttempt = 0; cdnAttempt < 3; cdnAttempt++) {
      try {
        const completeRes = await new Promise<any>((resolve, reject) => {
          const req = https.request({
            hostname: uploadHost,
            port: 443,
            path: `/api/upload/complete?upload_token=${encodeURIComponent(token)}&fragment_count=${totalChunks}`,
            method: 'POST',
            agent,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(completeBody),
              'Referer': REFERER,
              'Origin': ORIGIN
            }
          }, (res: any) => {
            let data = ''
            res.on('data', (c: Buffer) => { data += c.toString() })
            res.on('end', () => {
              try { resolve(JSON.parse(data)) } catch { resolve({ raw: data }) }
            })
          })
          req.on('error', reject)
          req.setTimeout(60_000, () => { req.destroy(); reject(new Error('CDN upload/complete timeout')) })
          req.write(completeBody)
          req.end()
        })
        logger.info(`[kuaishou] CDN upload/complete response (attempt ${cdnAttempt + 1}): ${JSON.stringify(completeRes).substring(0, 500)}`)

        // Check for success — result=1 or HTTP-level acknowledgment
        if (completeRes?.result === 1 || completeRes?.status === 'ok' || completeRes?.success) {
          cdnCompleteOk = true
          break
        }
        // Some CDN endpoints return 200 with no explicit result field — treat as success
        if (completeRes && !completeRes.error && !completeRes.errMsg) {
          cdnCompleteOk = true
          break
        }
        logger.warn(`[kuaishou] CDN upload/complete returned non-success: ${JSON.stringify(completeRes).substring(0, 200)}`)
      } catch (e: any) {
        logger.warn(`[kuaishou] CDN upload/complete attempt ${cdnAttempt + 1} error: ${e.message}`)
      }
      if (cdnAttempt < 2) await delay(2000 * (cdnAttempt + 1))
    }

    if (!cdnCompleteOk) {
      logger.warn('[kuaishou] CDN upload/complete failed after all retries — upload/finish may fail')
    }

    agent.destroy()

    // Step 3b: REST API finish — requires __NS_sig3 URL signature
    const FINISH_INITIAL_DELAY = 8000
    const FINISH_MAX_RETRIES = 5
    const FINISH_RETRY_DELAY = 5000

    logger.info(`[kuaishou] Waiting ${FINISH_INITIAL_DELAY / 1000}s before REST upload/finish...`)
    await delay(FINISH_INITIAL_DELAY)

    // Note: yixiaoer uses "fileTyp" (no 'e') — this is what the server expects
    const finishBodyObj: Record<string, unknown> = {
      token,
      fileName: require('path').basename(filePath),
      fileTyp: 'video/mp4',
      fileLength: stats.size,
      'kuaishou.web.cp.api_ph': apiPh
    }
    // Include photoId from upload/pre if available — the browser sends this
    if (prePhotoId) {
      finishBodyObj.photoId = prePhotoId
    }
    const finishBody = JSON.stringify(finishBodyObj)

    const signService = getSignService()
    const finishSigPath = '/rest/cp/works/v2/video/pc/upload/finish'
    let finishSig3 = await signService.getSignature(
      'kuaishou',
      cookie,
      JSON.stringify({ url: finishSigPath, body: finishBody }),
      finishBody
    )

    let finishUrl = finishSig3
      ? `${API.uploadFinish}?__NS_sig3=${finishSig3}`
      : API.uploadFinish
    logger.info(`[kuaishou] Upload finish URL: ${finishUrl.substring(0, 100)}...`)

    let finishResponse: {
      result: number
      data?: {
        fileId?: number
        photoId?: string
        photoIdStr?: string
        mediaId?: string
        coverMediaId?: string
        coverKey?: string
        duration?: number
        width?: number
        height?: number
        videoFrameRate?: number
        videoDuration?: number
      }
    } | undefined
    let lastFinishError = ''

    for (let attempt = 0; attempt < FINISH_MAX_RETRIES; attempt++) {
      const res = await client.post<{
        result: number
        data?: { fileId?: number; photoId?: string }
      }>(
        finishUrl,
        finishBody,
        { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
      )

      logger.info(`[kuaishou] Upload finish response (attempt ${attempt + 1}): ${JSON.stringify(res.data)}`)

      if (res.data?.result === 1) {
        finishResponse = res.data
        break
      }

      lastFinishError = `result=${res.data?.result}`

      // 500002 = "请稍后重试" — server still processing fragments, need to wait longer
      if (res.data?.result === 500002) {
        logger.info(`[kuaishou] Upload finish returned 500002 (server still processing fragments)`)
      }

      if (attempt < FINISH_MAX_RETRIES - 1) {
        const backoff = FINISH_RETRY_DELAY * (attempt + 1)
        logger.info(`[kuaishou] Upload finish failed (${lastFinishError}), retrying in ${backoff / 1000}s...`)
        // Re-generate signature for retry
        finishSig3 = await signService.getSignature(
          'kuaishou',
          cookie,
          JSON.stringify({ url: finishSigPath, body: finishBody }),
          finishBody
        )
        if (finishSig3) {
          finishUrl = `${API.uploadFinish}?__NS_sig3=${finishSig3}`
        }
        await delay(backoff)
      }
    }

    if (!finishResponse || finishResponse.result !== 1) {
      throw new Error(`上传完成确认失败 (${lastFinishError})`)
    }

    const fileId = finishResponse.data?.fileId
    const photoId = finishResponse.data?.photoIdStr || finishResponse.data?.photoId || ''
    const d = finishResponse.data

    // Store for submitContentAPI
    this.lastUploadResult = {
      photoId,
      fileId: fileId || 0,
      token,
      fileSize: stats.size,
      videoWidth: d?.width || videoWidth,
      videoHeight: d?.height || videoHeight,
      videoDuration: d?.videoDuration || videoDuration,
      md5sum,
      mediaId: d?.mediaId || '',
      coverMediaId: d?.coverMediaId || '',
      coverKey: d?.coverKey || '',
      videoFrameRate: d?.videoFrameRate || 0
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

    // Platform-specific fields — view permission
    // Kuaishou privacyType: 0=公开, 1=好友可见, 2=仅自己可见
    let privacyType = 0
    if (Array.isArray(payload.platformFields?.viewPermission)) {
      const perm = payload.platformFields.viewPermission as string[]
      if (perm.includes('friends')) {
        privacyType = 1
      } else if (perm.includes('private')) {
        privacyType = 2
      } else {
        privacyType = 0 // 默认公开
      }
    }

    // Interaction settings — default all enabled
    // Field names match yixiaoer (快手创作者平台实际接受的字段名)
    const interactionSettings = Array.isArray(payload.platformFields?.interactionSettings)
      ? (payload.platformFields.interactionSettings as string[])
      : ['allowSameFrame', 'allowDownload', 'showInLocal']
    const allowSameFrame = interactionSettings.includes('allowSameFrame') ? 1 : 0
    const downloadType = interactionSettings.includes('allowDownload') ? 2 : 0
    const disableNearbyShow = interactionSettings.includes('showInLocal') ? 0 : 1

    // Author declaration — supplementary text
    const authorDeclaration = payload.platformFields?.authorDeclaration
      ? String(payload.platformFields.authorDeclaration)
      : ''

    const videoWidth = uploadResult?.videoWidth || 1920
    const videoHeight = uploadResult?.videoHeight || 1080
    const videoDuration = uploadResult?.videoDuration || 0

    // Build declareInfo with author declaration
    // Kuaishou author declaration options: AI生成, 演绎情节, 个人观点, 素材来源于网络
    const declareInfo: Record<string, unknown> = {
      source: 0,
      platform: 0,
      time: 0,
      location: '',
      sourceId: 0,
      sourceName: ''
    }

    // Map content declaration to Kuaishou API field
    // yixiaoer格式: declareInfo = { source: <number> }
    // source: 0=无, 1=AI生成, 2=演绎情节, 3=个人观点, 4=素材来源于网络
    const declarationSource = payload.platformFields?.authorDeclaration
      ? Number(payload.platformFields.authorDeclaration)
      : 0
    if (declarationSource > 0) {
      declareInfo.source = declarationSource
      logger.info(`[kuaishou] Content declaration: source=${declarationSource}`)
    }

    // Extract location data from platformFields
    let longitude = ''
    let latitude = ''
    let poiId: number | string = 0
    if (payload.platformFields?.location) {
      const loc = payload.platformFields.location
      if (typeof loc === 'object' && loc !== null && 'name' in loc) {
        const locObj = loc as { name: string; poi_id?: string; lat?: number; lng?: number }
        longitude = locObj.lng ? String(locObj.lng) : ''
        latitude = locObj.lat ? String(locObj.lat) : ''
        poiId = locObj.poi_id || 0
        declareInfo.location = locObj.name
        logger.info(`[kuaishou] Added location: ${locObj.name}, poiId=${poiId}`)
      }
    }

    const params: Record<string, unknown> = {
      fileId,
      coverKey: uploadResult?.coverKey || '',
      coverTimeStamp: 0,
      caption: caption.trim(),
      photoStatus: 1,
      coverType: 1,
      coverTitle: '',
      photoType: 0,
      privacyType,
      width: videoWidth,
      height: videoHeight,
      collectionId: '',
      publishTime: 0,
      longitude,
      latitude,
      poiId,
      notifyResult: 0,
      domain: '',
      secondDomain: '',
      coverUrl: '',
      'kuaishou.web.cp.api_ph': apiPh,
      mediaId: uploadResult?.mediaId || '',
      coverMediaId: uploadResult?.coverMediaId || '',
      videoDuration: videoDuration,
      videoFrameRate: uploadResult?.videoFrameRate || 0,
      declareInfo,
      allowSameFrame,
      downloadType,
      disableNearbyShow
    }

    logger.info(`[kuaishou] Submitting: fileId=${fileId}, caption=${caption.substring(0, 80)}`)

    // Submit via HttpClient + SignService with __NS_sig3
    const submitBody = JSON.stringify(params)
    const signService = getSignService()
    const submitSigPath = '/rest/cp/works/v2/video/pc/submit'
    let submitSig3 = await signService.getSignature(
      'kuaishou',
      cookie,
      JSON.stringify({ url: submitSigPath, body: submitBody }),
      submitBody
    )

    let submitUrl = submitSig3
      ? `${API.submit}?__NS_sig3=${submitSig3}`
      : API.submit

    const SUBMIT_MAX_RETRIES = 3
    const SUBMIT_RETRY_DELAY = 5000
    let lastSubmitError = ''

    for (let attempt = 0; attempt < SUBMIT_MAX_RETRIES; attempt++) {
      const response = await client.post<{
        result: number
        data?: { photoId?: string }
        error_msg?: string
        message?: string
      }>(
        submitUrl,
        submitBody,
        { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }
      )

      logger.info(`[kuaishou] Submit response (attempt ${attempt + 1}): ${JSON.stringify(response.data).substring(0, 500)}`)

      if (response.data?.result === 1) {
        logger.info(`[kuaishou] Content submitted successfully`)
        return
      }

      lastSubmitError = response.data?.error_msg || response.data?.message || `result=${response.data?.result}`

      if (response.data?.result === 500002 || response.data?.result === 300801) {
        if (attempt < SUBMIT_MAX_RETRIES - 1) {
          const backoff = SUBMIT_RETRY_DELAY * (attempt + 1)
          logger.info(`[kuaishou] Submit failed (${lastSubmitError}), retrying in ${backoff / 1000}s...`)
          submitSig3 = await signService.getSignature(
            'kuaishou',
            cookie,
            JSON.stringify({ url: submitSigPath, body: submitBody }),
            submitBody
          )
          if (submitSig3) {
            submitUrl = `${API.submit}?__NS_sig3=${submitSig3}`
          }
          await delay(backoff)
        }
      } else {
        break
      }
    }

    throw new Error(`内容提交失败: ${lastSubmitError}`)
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

  /**
   * Get recommended POI locations on Kuaishou.
   * Matching yixiaoer's getLocationResponse$1 flow:
   * 1. If GPS coordinates → use poi/nearby to get cityName + locations
   * 2. Otherwise → use ip2poi to get cityName
   * 3. Call poi/search with the cityName
   *
   * IMPORTANT: poi/nearby and poi/search do NOT use __NS_sig3 signature!
   */
  async getRecommendLocations(client: HttpClient, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()

      logger.info(`[kuaishou] getRecommendLocations called with options:`, options)

      // 提取 kuaishou.web.cp.api_ph
      const apiPhMatch = cookie.match(/kuaishou\.web\.cp\.api_ph=([a-z0-9]+)/)
      const apiPh = apiPhMatch ? apiPhMatch[1] : ''

      let cityName = ''

      // Step 1: Get cityName via poi/nearby (matching yixiaoer's getLocationNearByResponse)
      // NOTE: No __NS_sig3 for location endpoints!
      if (options?.lat && options?.lng) {
        try {
          const nearbyUrl = `https://cp.kuaishou.com/rest/zt/location/wi/poi/nearby?kpn=kuaishou_cp&subBiz=CP%2FCREATOR_PLATFORM&kpf=PC_WEB&kuaishou.web.cp.api_ph=${apiPh}`
          const nearbyBody = JSON.stringify({
            location: `${options.lat},${options.lng}`,
            count: options?.count || 20,
            "kuaishou.web.cp.api_ph": apiPh
          })

          logger.info(`[kuaishou] POI nearby request:`, { url: nearbyUrl, body: nearbyBody })

          const nearbyResponse = await client.post<any>(nearbyUrl, nearbyBody, {
            referer: REFERER, 'Content-Type': 'application/json'
          })

          // Response: { result, data: { cityName, locations: [...] } }
          logger.info(`[kuaishou] POI nearby response: result=${nearbyResponse.data?.result}, cityName=${nearbyResponse.data?.data?.cityName}, locations=${nearbyResponse.data?.data?.locations?.length || 0}`)

          if (nearbyResponse.data?.result === 1 && nearbyResponse.data?.data) {
            cityName = nearbyResponse.data.data.cityName || ''
            const nearbyLocations = nearbyResponse.data.data.locations || []
            if (nearbyLocations.length > 0) {
              logger.info(`[kuaishou] Got ${nearbyLocations.length} locations from nearby, cityName="${cityName}"`)
              return nearbyLocations.map((poi: any) => ({
                id: poi.id?.toString() || '',
                name: poi.title || '',
                address: poi.address || '',
                lat: poi.latitude,
                lng: poi.longitude,
                poi_id: poi.id?.toString(),
                extra: { city: poi.city }
              }))
            }
          }
        } catch (e) {
          logger.warn('[kuaishou] POI nearby failed, falling back to ip2poi:', e)
        }
      }

      // Fallback: use ip2poi to get city (matching yixiaoer's getCurrentCity)
      if (!cityName) {
        try {
          const cityUrl = 'https://cp.kuaishou.com/rest/cp/works/v2/common/pc/ip2poi'
          const cityBody = JSON.stringify({ "kuaishou.web.cp.api_ph": apiPh })
          const cityResponse = await client.post<any>(cityUrl, cityBody, {
            referer: REFERER, 'Content-Type': 'application/json'
          }, { responseType: 'text' })
          logger.info(`[kuaishou] ip2poi raw response (first 500):`, typeof cityResponse.data === 'string' ? cityResponse.data.substring(0, 500) : JSON.stringify(cityResponse.data).substring(0, 500))

          try {
            const parsed = typeof cityResponse.data === 'string' ? JSON.parse(cityResponse.data) : cityResponse.data
            if (parsed?.result === 1) {
              // yixiaoer accesses: response.data.city.data.city (nested) or response.data.city (direct)
              const nestedCity = parsed?.data?.city?.data?.city
              if (nestedCity && typeof nestedCity === 'string') {
                cityName = nestedCity
              } else {
                cityName = parsed?.data?.city || ''
              }
              logger.info(`[kuaishou] Current city from ip2poi: "${cityName}"`)
            }
          } catch (parseErr) {
            logger.warn('[kuaishou] Failed to parse ip2poi response:', parseErr)
          }
        } catch (e) {
          logger.warn('[kuaishou] Failed to get current city:', e)
        }
      }

      // yixiaoer: append "市" unless city already contains "自治"
      if (cityName) {
        if (!cityName.includes('自治')) {
          cityName = cityName + '市'
        }
        logger.info(`[kuaishou] City name after processing: "${cityName}"`)
      } else {
        cityName = '北京市'
        logger.info(`[kuaishou] Using default city: ${cityName}`)
      }

      // Step 2: Call poi/search with cityName (matching yixiaoer)
      // NOTE: No __NS_sig3 for location endpoints!
      const searchUrl = `https://cp.kuaishou.com/rest/zt/location/wi/poi/search?kpn=kuaishou_cp&subBiz=CP%2FCREATOR_PLATFORM&kpf=PC_WEB&kuaishou.web.cp.api_ph=${apiPh}`
      const body = JSON.stringify({
        cityName: cityName,
        count: options?.count || 20,
        keyword: cityName,
        pcursor: '',
        "kuaishou.web.cp.api_ph": apiPh
      })

      logger.info(`[kuaishou] POI search request:`, { url: searchUrl, body })

      const response = await client.post<any>(
        searchUrl,
        body,
        {
          referer: REFERER,
          'Content-Type': 'application/json'
        }
      )

      // yixiaoer: response.locations is the field name (not data.locations or data.poiList)
      const locations = response.data?.data?.locations || response.data?.locations || []

      logger.info(`[kuaishou] POI search response: result=${response.data?.result}, locations=${locations.length}`)

      if (response.data?.result !== 1 || !locations.length) {
        logger.warn(`[kuaishou] POI search failed: result=${response.data?.result}`)
        return []
      }

      const results: import('../IPlatformAdapter').LocationResult[] = locations.map((poi: any) => ({
        id: poi.id?.toString() || poi.poiId || '',
        name: poi.title || poi.poiName || '',
        address: poi.address || poi.city || '',
        lat: poi.latitude,
        lng: poi.longitude,
        poi_id: poi.id?.toString() || poi.poiId,
        extra: { city: poi.city }
      }))

      // Add city-level option as first result if not already present
      const cityDisplayName = cityName.replace('市', '')
      if (cityDisplayName && !results.some(r => r.name === cityDisplayName || r.name === cityName)) {
        results.unshift({
          id: `city_${cityDisplayName}`,
          name: cityDisplayName,
          address: cityName,
          lat: options?.lat,
          lng: options?.lng,
          poi_id: `city_${cityDisplayName}`,
          extra: { city: cityDisplayName, isCityLevel: true }
        })
      }

      return results
    } catch (err) {
      logger.error('[kuaishou] getRecommendLocations error:', err)
      return []
    }
  }

  /**
   * Search POI locations on Kuaishou.
   * Uses the same endpoint as recommend (matching yixiaoer's getLocationResponse$1).
   * NOTE: No __NS_sig3 for location endpoints!
   */
  async searchLocation(client: HttpClient, keyword: string, options?: { lat?: number; lng?: number; count?: number }): Promise<import('../IPlatformAdapter').LocationResult[]> {
    try {
      const cookie = client.getCookieString()
      const apiPhMatch = cookie.match(/kuaishou\.web\.cp\.api_ph=([a-z0-9]+)/)
      const apiPh = apiPhMatch ? apiPhMatch[1] : ''

      // Get city name for the search (same as recommend flow)
      let cityName = '北京市'
      try {
        const cityUrl = 'https://cp.kuaishou.com/rest/cp/works/v2/common/pc/ip2poi'
        const cityBody = JSON.stringify({ "kuaishou.web.cp.api_ph": apiPh })
        const cityResponse = await client.post<any>(cityUrl, cityBody, {
          referer: REFERER, 'Content-Type': 'application/json'
        }, { responseType: 'text' })
        const parsed = typeof cityResponse.data === 'string' ? JSON.parse(cityResponse.data) : cityResponse.data
        if (parsed?.result === 1) {
          const nestedCity = parsed?.data?.city?.data?.city
          const rawCity = nestedCity || parsed?.data?.city || ''
          if (rawCity) {
            cityName = rawCity.includes('自治') ? rawCity : rawCity + '市'
          }
        }
      } catch { /* use default */ }

      // Use the same endpoint as recommend (matching yixiaoer)
      const searchUrl = `https://cp.kuaishou.com/rest/zt/location/wi/poi/search?kpn=kuaishou_cp&subBiz=CP%2FCREATOR_PLATFORM&kpf=PC_WEB&kuaishou.web.cp.api_ph=${apiPh}`
      const body = JSON.stringify({
        cityName,
        count: options?.count || 20,
        keyword: keyword,
        pcursor: '',
        "kuaishou.web.cp.api_ph": apiPh
      })

      const response = await client.post<any>(
        searchUrl,
        body,
        {
          referer: REFERER,
          'Content-Type': 'application/json'
        }
      )

      logger.info(`[kuaishou] searchLocation response: result=${response.data?.result}, hasData=${!!response.data?.data}`)

      // yixiaoer: response.locations (not data.locations)
      const locations = response.data?.data?.locations || response.data?.locations || []
      if (response.data?.result !== 1 || !locations.length) {
        logger.warn(`[kuaishou] POI search failed: result=${response.data?.result}`)
        return []
      }

      return locations.map((poi: any) => ({
        id: poi.id?.toString() || poi.poiId || '',
        name: poi.title || poi.poiName || '',
        address: poi.address || poi.city || '',
        lat: poi.latitude,
        lng: poi.longitude,
        poi_id: poi.id?.toString() || poi.poiId,
        extra: { city: poi.city }
      }))
    } catch (err) {
      logger.error('[kuaishou] searchLocation error:', err)
      return []
    }
  }
}
