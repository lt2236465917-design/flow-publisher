import type { BrowserContext, Page } from 'playwright-core'
import { BasePlatformAdapter } from '../BasePlatformAdapter'
import type { UploadProgress, SubmitContentPayload, VideoConstraints, UploadResult } from '../IPlatformAdapter'
import { getPublishRecordRepository } from '../../database'
import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { SubmitResult, VideoListResult } from '../../../../shared/types/analytics'
import type { HttpClient } from '../../http/HttpClient'
import { KS_URLS } from './ks-urls'
import { KS_SELECTORS } from './ks-selectors'
import { logger } from '../../../utils/logger'
import { delay } from '../../../utils/delays'
import { existsSync, statSync, readFileSync } from 'fs'
import { ffmpegService } from '../../ffmpeg/FFmpegService'
import { computeFileMd5 } from '../../../utils/file-hash'
import { openChunkedReader } from '../../../utils/chunked-reader'
import { getSignService } from '../../sign/SignService'
import { KuaishouOpenApiPublisher } from '../../openapi/KuaishouOpenApiPublisher'

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

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function isLikelyNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase()
  return [
    'timeout',
    'timed out',
    'err_timed_out',
    'econnaborted',
    'etimedout',
    'econnreset',
    'enotfound',
    'eai_again',
    'socket hang up',
    'network',
    '无响应',
    '不可用',
    '超时'
  ].some((needle) => lower.includes(needle))
}

function isKuaishouRetryLater(result?: number, message?: string): boolean {
  return result === 500002 || /请稍后重试/.test(message || '')
}

export class KsApiAdapter extends BasePlatformAdapter {
  readonly platformId = 'kuaishou'
  readonly platformName = '快手'
  readonly loginUrl = KS_URLS.login

  // Cached account info from userInfo API
  private cachedDisplayName: string = ''
  private cachedUserId: string = ''

  // H11 fix: lastUploadResult moved to DB-backed upload_meta column.
  // submitContentAPI now reads metadata from publish_records.upload_meta.
  private readonly openApiPublisher = new KuaishouOpenApiPublisher()

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
    let hasEssentialCookies = false
    try {
      const cookie = client.getCookieString()
      if (!cookie) return false

      const hasUserId = /(?:^|;\s*)userId=[^;]+/.test(cookie)
      const hasApiSt = /(?:^|;\s*)kuaishou\.web\.cp\.api_st=[^;]+/.test(cookie)
      const apiPh = this.extractApiPh(cookie)
      hasEssentialCookies = hasUserId && hasApiSt && !!apiPh

      if (!hasEssentialCookies) {
        logger.warn(
          `[kuaishou] Session invalid: missing essential cookies ` +
          `(userId=${hasUserId}, api_st=${hasApiSt}, api_ph=${apiPh ? 'yes' : 'no'})`
        )
        return false
      }

      const body = JSON.stringify({ 'kuaishou.web.cp.api_ph': apiPh })
      let lastRetryLaterMessage = ''
      for (let attempt = 0; attempt < 3; attempt++) {
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
          { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' },
          { timeout: readPositiveIntEnv('FLOW_PUBLISHER_KUAISHOU_SESSION_CHECK_TIMEOUT_MS', 10_000) }
        )

        logger.info(
          `[kuaishou] checkSessionAPI response (attempt ${attempt + 1}): status=${response.status}, ` +
          `body=${JSON.stringify(response.data).substring(0, 500)}`
        )

        if (response.data?.result === 1 && response.data?.data) {
          const data = response.data.data
          this.cachedDisplayName = data.user_name || this.cachedDisplayName
          this.cachedUserId = data.user_id || this.cachedUserId
          logger.info(`[kuaishou] Session valid via creator API, userId=${data.user_id || 'unknown'}`)
          return true
        }

        const message = response.data?.message || response.data?.error_msg || ''
        if (isKuaishouRetryLater(response.data?.result, message)) {
          lastRetryLaterMessage = `result=${response.data?.result}, message=${message || '请稍后重试'}`
          if (attempt < 2) {
            await delay(1000 * (attempt + 1))
            continue
          }

          logger.warn(
            `[kuaishou] checkSessionAPI got retry-later response after login cookies were present; ` +
            `allowing publish preflight to continue (${lastRetryLaterMessage})`
          )
          return true
        }

        logger.warn(
          `[kuaishou] Session invalid from creator API: result=${response.data?.result}, ` +
          `message=${message || 'none'}`
        )
        return false
      }

      logger.warn(`[kuaishou] checkSessionAPI retry-later exhausted; allowing upload/pre to provide final verdict (${lastRetryLaterMessage})`)
      return true
    } catch (err) {
      const message = describeError(err)
      logger.warn(`[kuaishou] checkSessionAPI real API check failed: ${message}`)
      if (hasEssentialCookies && isLikelyNetworkFailure(message)) {
        logger.warn('[kuaishou] checkSessionAPI network failure with essential cookies present; allowing upload/pre to provide final verdict')
        return true
      }
      return false
    }
  }

  async uploadVideoAPI(
    client: HttpClient,
    filePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<string | UploadResult> {
    if (!existsSync(filePath)) {
      throw new Error(`视频文件不存在: ${filePath}`)
    }

    const stats = statSync(filePath)
    const fileSizeMB = stats.size / (1024 * 1024)
    const constraints = this.getVideoConstraints()
    if (fileSizeMB > constraints.maxFileSizeMB) {
      throw new Error(`视频文件过大: ${fileSizeMB.toFixed(1)}MB，最大 ${constraints.maxFileSizeMB}MB`)
    }

    if (this.openApiPublisher.isConfigured()) {
      logger.info('[kuaishou] Official OpenAPI configured, publishing through kuaishou openapi channel')
      onProgress?.({ percent: 5, stage: '正在使用快手官方 OpenAPI 上传...' })
      return await this.openApiPublisher.uploadVideo(filePath, onProgress)
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

    const md5sum = await computeFileMd5(filePath)
    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    onProgress?.({ percent: 5, stage: '正在获取上传凭证...' })

    // Step 1: Get upload token — uploadType: 1 (numeric, not string!)
    const preBody = JSON.stringify({ uploadType: 1, 'kuaishou.web.cp.api_ph': apiPh })

    let preData: { token?: string; fileId?: number; photoId?: string } | null = null
    const preErrors: string[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const preResponseData = await this.postKuaishouJsonWithBrowserFallback<{
          result: number
          currentTime?: number
          data?: { token?: string; fileId?: number; photoId?: string }
          error_msg?: string
          message?: string
        }>(
          client,
          cookie,
          API.uploadPre,
          preBody,
          { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' },
          '获取上传凭证 upload/pre'
        )

        logger.info(`[kuaishou] Upload pre response: ${JSON.stringify(preResponseData)}`)

        if (preResponseData?.result === 1 && preResponseData?.data?.token) {
          preData = preResponseData.data
          break
        }

        logger.warn(`[kuaishou] Upload pre attempt ${attempt + 1} failed: ${JSON.stringify(preResponseData).substring(0, 300)}`)
        preErrors.push(
          `第 ${attempt + 1} 次接口返回 result=${preResponseData?.result}, ` +
          `message=${preResponseData?.message || preResponseData?.error_msg || 'no token'}`
        )
      } catch (err) {
        const message = describeError(err)
        preErrors.push(`第 ${attempt + 1} 次异常：${message}`)
        logger.warn(`[kuaishou] Upload pre attempt ${attempt + 1} error: ${message}`)
      }

      if (attempt < 2) await delay(1000 * (attempt + 1))
    }

    if (!preData?.token) {
      const detail = preErrors.slice(-3).join(' | ') || '快手接口未返回上传 token'
      if (isLikelyNetworkFailure(detail)) {
        throw new Error(
          `获取上传凭证失败：快手创作者接口超时或网络不可达（${detail}）。` +
          '请确认当前网络、VPN 或代理能稳定访问 cp.kuaishou.com，然后重新检查快手登录状态后重试。'
        )
      }
      throw new Error(
        `获取上传凭证失败：${detail}。` +
        '请重新登录快手创作者中心；如果页面能正常打开但仍失败，通常是账号风控或接口签名策略变更。'
      )
    }

    const { token, fileId: preFileId, photoId: prePhotoId } = preData
    logger.info(`[kuaishou] Upload token obtained: ${token.substring(0, 30)}..., fileId: ${preFileId || 'N/A'}, photoId: ${prePhotoId || 'N/A'}`)

    onProgress?.({ percent: 10, stage: '正在上传视频...' })

    // Step 2: Upload fragments (4MB each, matching browser behavior)
    // Use chunked reader — reads each chunk on-demand, never loads the entire file into memory
    const reader = await openChunkedReader(filePath, CHUNK_SIZE)
    const totalChunks = reader.totalChunks
    const https = require('https')
    const agent = new https.Agent({ keepAlive: true, maxSockets: 3, rejectUnauthorized: false })

    let completedChunks = 0
    const uploadHost = 'upload.kuaishouzt.com'

    try {

    for (let i = 0; i < totalChunks; i++) {
      const chunk = await reader.readChunk(i)

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

    } finally {
      await reader.close()
      agent.destroy()
    }

    // Step 3b: REST API finish — requires __NS_sig3 URL signature
    const FINISH_INITIAL_DELAY = readPositiveIntEnv('FLOW_PUBLISHER_KUAISHOU_FINISH_INITIAL_DELAY_MS', 12_000)
    const FINISH_TIMEOUT_MS = readPositiveIntEnv(
      'FLOW_PUBLISHER_KUAISHOU_FINISH_TIMEOUT_MS',
      Math.min(480_000, Math.max(180_000, videoDuration ? videoDuration * 2500 : 180_000))
    )
    const FINISH_MAX_RETRY_DELAY = readPositiveIntEnv('FLOW_PUBLISHER_KUAISHOU_FINISH_MAX_RETRY_DELAY_MS', 30_000)

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
    if (preFileId) {
      finishBodyObj.fileId = preFileId
    }
    // Include photoId from upload/pre if available — the browser sends this
    if (prePhotoId) {
      finishBodyObj.photoId = prePhotoId
    }
    const finishBody = JSON.stringify(finishBodyObj)
    logger.info(`[kuaishou] Upload finish body keys: ${Object.keys(finishBodyObj).join(',')}`)

    const finishSigPath = '/rest/cp/works/v2/video/pc/upload/finish'
    const finishHeaders = { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }

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

    const finishStartedAt = Date.now()
    let finishAttempt = 0

    while (Date.now() - finishStartedAt <= FINISH_TIMEOUT_MS) {
      finishAttempt++
      const responseData = await this.postKuaishouSignedJson<{
        result: number
        error_msg?: string
        message?: string
        data?: NonNullable<typeof finishResponse>['data']
      }>(
        client,
        cookie,
        API.uploadFinish,
        finishSigPath,
        finishBody,
        finishHeaders,
        { requireSig3: true, action: '上传完成确认 upload/finish' }
      )

      logger.info(`[kuaishou] Upload finish response (attempt ${finishAttempt}): ${JSON.stringify(responseData)}`)

      if (responseData?.result === 1) {
        finishResponse = responseData
        break
      }

      const resultCode = responseData?.result
      const resultMessage = responseData?.message || responseData?.error_msg
      lastFinishError = resultMessage ? `result=${resultCode}, message=${resultMessage}` : `result=${resultCode}`

      // 500002 = "请稍后重试" — server still processing fragments, need to wait longer
      const retryable = responseData?.result === 500002 || responseData?.result === undefined
      if (!retryable) break

      const elapsed = Date.now() - finishStartedAt
      const remaining = FINISH_TIMEOUT_MS - elapsed
      if (remaining <= 0) break

      const backoff = Math.min(FINISH_MAX_RETRY_DELAY, 5000 * finishAttempt, remaining)
      logger.info(
        `[kuaishou] Upload finish still processing (${lastFinishError}), ` +
        `retrying in ${Math.round(backoff / 1000)}s (elapsed ${Math.round(elapsed / 1000)}s, budget ${Math.round(FINISH_TIMEOUT_MS / 1000)}s)...`
      )
      onProgress?.({ percent: 88, stage: `快手正在处理视频，等待确认 ${finishAttempt}` })
      await delay(backoff)
    }

    if (!finishResponse || finishResponse.result !== 1) {
      throw new Error(
        `上传完成确认失败 (${lastFinishError}，等待 ${Math.round(FINISH_TIMEOUT_MS / 1000)} 秒后仍未完成)。` +
        '快手 upload/finish 长时间返回“请稍后重试”通常表示视频仍在平台处理，或 __NS_sig3 签名没有完整生成。' +
        '请确认本机 signer 可用；如果只是处理慢，可临时调大 FLOW_PUBLISHER_KUAISHOU_FINISH_TIMEOUT_MS 后重试。'
      )
    }

    const fileId = finishResponse.data?.fileId
    const photoId = finishResponse.data?.photoIdStr || finishResponse.data?.photoId || ''
    const d = finishResponse.data

    // Build structured upload result (H11 fix — no mutable instance state)
    const uploadMeta: Record<string, unknown> = {
      fileId: fileId || 0,
      photoId,
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

    return { videoId: String(fileId || photoId || token), meta: uploadMeta }
  }

  /**
   * Upload custom cover image to Kuaishou.
   * Uses the same CDN fragment upload flow as video:
   *   1. upload/pre → get token
   *   2. Upload image as single fragment to CDN
   *   3. CDN upload/complete
   *   4. REST upload/finish → get coverKey
   * Returns the coverKey to use in submitContentAPI.
   */
  async uploadCoverImageAPI(
    client: HttpClient,
    imagePath: string,
    onProgress?: (p: UploadProgress) => void
  ): Promise<string> {
    if (!existsSync(imagePath)) {
      throw new Error(`封面图片不存在: ${imagePath}`)
    }

    const stats = statSync(imagePath)
    const coverData = readFileSync(imagePath)
    logger.info(`[kuaishou] Uploading cover image: ${imagePath}, size=${stats.size} bytes`)

    onProgress?.({ percent: 0, stage: '正在获取封面上传凭证...' })

    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)
    const https = require('https')
    const agent = new https.Agent({ keepAlive: true, maxSockets: 3, rejectUnauthorized: false })

    try {
      // Step 1: Get upload token (reuse video upload/pre endpoint)
      const preBody = JSON.stringify({ uploadType: 1, 'kuaishou.web.cp.api_ph': apiPh })
      let token = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const preResponseData = await this.postKuaishouJsonWithBrowserFallback<any>(
            client,
            cookie,
            API.uploadPre,
            preBody,
            { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' },
            '获取封面上传凭证 upload/pre'
          )
          logger.info(`[kuaishou] Cover upload/pre response: ${JSON.stringify(preResponseData).substring(0, 300)}`)
          if (preResponseData?.result === 1 && preResponseData?.data?.token) {
            token = preResponseData.data.token
            break
          }
        } catch (err: any) {
          logger.warn(`[kuaishou] Cover upload/pre attempt ${attempt + 1} error: ${err.message}`)
        }
        if (attempt < 2) await delay(1000 * (attempt + 1))
      }
      if (!token) throw new Error('获取封面上传凭证失败')

      onProgress?.({ percent: 20, stage: '正在上传封面图片...' })

      // Step 2: Upload image as single fragment to CDN
      const uploadHost = 'upload.kuaishouzt.com'
      await new Promise<void>((resolve, reject) => {
        const req = https.request({
          hostname: uploadHost,
          port: 443,
          path: `/api/upload/fragment?upload_token=${encodeURIComponent(token)}&fragment_id=0`,
          method: 'POST',
          agent,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': coverData.length,
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
                if (json.result === 1) { resolve() }
                else { reject(new Error(`Cover fragment upload failed: ${data.substring(0, 200)}`)) }
              } catch { reject(new Error(`Cover fragment non-JSON: ${data.substring(0, 200)}`)) }
            } else {
              reject(new Error(`Cover fragment HTTP ${res.statusCode}: ${data.substring(0, 200)}`))
            }
          })
        })
        req.on('error', reject)
        req.setTimeout(60_000, () => { req.destroy(); reject(new Error('Cover fragment timeout')) })
        req.write(coverData)
        req.end()
      })

      logger.info('[kuaishou] Cover fragment uploaded to CDN')
      onProgress?.({ percent: 60, stage: '正在完成封面上传...' })

      // Step 3: CDN upload/complete
      const completeBody = JSON.stringify({ upload_token: token, fragment_count: 1 })
      await new Promise<void>((resolve, reject) => {
        const req = https.request({
          hostname: uploadHost,
          port: 443,
          path: `/api/upload/complete?upload_token=${encodeURIComponent(token)}&fragment_count=1`,
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
            logger.info(`[kuaishou] Cover CDN complete response: ${data.substring(0, 300)}`)
            resolve() // CDN complete is best-effort
          })
        })
        req.on('error', (e: Error) => { logger.warn(`[kuaishou] Cover CDN complete error: ${e.message}`); resolve() })
        req.setTimeout(30_000, () => { req.destroy(); resolve() })
        req.write(completeBody)
        req.end()
      })

      // Step 4: REST upload/finish — get coverKey
      onProgress?.({ percent: 80, stage: '正在确认封面上传...' })
      await delay(3000) // Brief wait for server processing

      const ext = require('path').extname(imagePath).toLowerCase()
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      const finishBodyObj: Record<string, unknown> = {
        token,
        fileName: require('path').basename(imagePath),
        fileTyp: mimeType,
        fileLength: stats.size,
        'kuaishou.web.cp.api_ph': apiPh
      }
      const finishBody = JSON.stringify(finishBodyObj)

      const sigPath = '/rest/cp/works/v2/video/pc/upload/finish'
      const finishHeaders = { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }

      let coverKey = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const responseData = await this.postKuaishouSignedJson<any>(
          client,
          cookie,
          API.uploadFinish,
          sigPath,
          finishBody,
          finishHeaders,
          { requireSig3: true, action: '封面上传完成确认 upload/finish' }
        )
        logger.info(`[kuaishou] Cover upload/finish response (attempt ${attempt + 1}): ${JSON.stringify(responseData).substring(0, 500)}`)

        if (responseData?.result === 1 && responseData?.data) {
          // Extract coverKey from the finish response
          coverKey = responseData.data.coverKey || responseData.data.photoIdStr || String(responseData.data.fileId || '')
          break
        }

        if (responseData?.result === 500002) {
          logger.info('[kuaishou] Cover upload/finish returned 500002, waiting...')
        }

        if (attempt < 2) {
          await delay(3000 * (attempt + 1))
        }
      }

      if (!coverKey) {
        throw new Error('封面上传完成但未获取到coverKey')
      }

      logger.info(`[kuaishou] Cover uploaded successfully: coverKey=${coverKey}`)
      onProgress?.({ percent: 100, stage: '封面上传完成' })
      return coverKey
    } finally {
      agent.destroy()
    }
  }

  async submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string, coverFileId?: string): Promise<SubmitResult> {
    // Read upload metadata from DB (H11 fix — no mutable instance state; H7 fix — survives crash)
    let uploadMeta: Record<string, unknown> | null = null
    if (payload.recordId) {
      uploadMeta = getPublishRecordRepository().getUploadMeta(payload.recordId)
    }

    if (uploadMeta?.channel === 'kuaishou-openapi') {
      const uploadToken = String(uploadMeta.uploadToken || videoId || '')
      if (!uploadToken) {
        throw new Error('缺少快手官方 OpenAPI upload_token，请重新上传视频')
      }
      logger.info('[kuaishou] Submitting through official OpenAPI channel')
      return await this.openApiPublisher.publish({
        uploadToken,
        caption: this.buildCaption(payload),
        coverPath: payload.coverPath
      })
    }

    const fileId = (uploadMeta?.fileId as number) || Number(videoId) || 0

    if (!fileId) {
      throw new Error('缺少视频ID (fileId)，请先上传视频')
    }

    const cookie = client.getCookieString()
    const apiPh = this.extractApiPh(cookie)

    const caption = this.buildCaption(payload)

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
    // IMPORTANT: Kuaishou API expects BOOLEAN values, not numbers!
    // Verified from real browser capture: allowSameFrame=true, downloadType=1, disableNearbyShow=false
    const interactionSettings = Array.isArray(payload.platformFields?.interactionSettings)
      ? (payload.platformFields.interactionSettings as string[])
      : ['allowSameFrame', 'allowDownload', 'showInLocal']
    const allowSameFrame = interactionSettings.includes('allowSameFrame')  // boolean
    const downloadType = interactionSettings.includes('allowDownload') ? 1 : 0  // 1=allowed, 0=disabled
    const disableNearbyShow = !interactionSettings.includes('showInLocal')  // boolean, inverted

    // Author declaration — supplementary text
    const authorDeclaration = payload.platformFields?.authorDeclaration
      ? String(payload.platformFields.authorDeclaration)
      : ''

    const videoWidth = (uploadMeta?.videoWidth as number) || 1920
    const videoHeight = (uploadMeta?.videoHeight as number) || 1080
    const videoDuration = (uploadMeta?.videoDuration as number) || 0

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
      // Priority: uploaded custom cover > auto-generated cover from video upload
      coverKey: coverFileId || (uploadMeta?.coverKey as string) || '',
      coverTimeStamp: 0,
      caption: caption.trim(),
      photoStatus: 1,
      // coverType: 2 = custom cover uploaded by user, 1 = auto-generated from video
      coverType: coverFileId ? 2 : 1,
      coverTitle: '',
      coverCropped: !!coverFileId,
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
      mediaId: (uploadMeta?.mediaId as string) || '',
      coverMediaId: (uploadMeta?.coverMediaId as string) || '',
      videoDuration: videoDuration,
      videoFrameRate: (uploadMeta?.videoFrameRate as number) || 0,
      declareInfo,
      allowSameFrame,
      downloadType,
      disableNearbyShow
    }

    logger.info(`[kuaishou] Submitting: fileId=${fileId}, coverKey=${coverFileId || (uploadMeta?.coverKey as string) || 'auto'}, caption=${caption.substring(0, 80)}`)

    // Submit via HttpClient + SignService with __NS_sig3
    const submitBody = JSON.stringify(params)
    const submitSigPath = '/rest/cp/works/v2/video/pc/submit'
    const submitHeaders = { referer: REFERER, Origin: ORIGIN, 'Content-Type': 'application/json' }

    const SUBMIT_MAX_RETRIES = 3
    const SUBMIT_RETRY_DELAY = 5000
    let lastSubmitError = ''

    for (let attempt = 0; attempt < SUBMIT_MAX_RETRIES; attempt++) {
      const responseData = await this.postKuaishouSignedJson<{
        result: number
        data?: { photoId?: string }
        error_msg?: string
        message?: string
      }>(
        client,
        cookie,
        API.submit,
        submitSigPath,
        submitBody,
        submitHeaders,
        { requireSig3: true, action: '内容提交 submit' }
      )

      logger.info(`[kuaishou] Submit response (attempt ${attempt + 1}): ${JSON.stringify(responseData).substring(0, 500)}`)

      if (responseData?.result === 1) {
        const submittedPhotoId = responseData?.data?.photoId || String(uploadMeta?.photoId || '')
        logger.info(`[kuaishou] Content submitted successfully, photoId: ${submittedPhotoId}`)
        return {
          contentId: submittedPhotoId,
          publishUrl: submittedPhotoId ? `https://www.kuaishou.com/short-video/${submittedPhotoId}` : undefined
        }
      }

      lastSubmitError = responseData?.error_msg || responseData?.message || `result=${responseData?.result}`

      if (responseData?.result === 500002 || responseData?.result === 300801) {
        if (attempt < SUBMIT_MAX_RETRIES - 1) {
          const backoff = SUBMIT_RETRY_DELAY * (attempt + 1)
          logger.info(`[kuaishou] Submit failed (${lastSubmitError}), retrying in ${backoff / 1000}s...`)
          await delay(backoff)
        }
      } else {
        break
      }
    }

    throw new Error(`内容提交失败: ${lastSubmitError}`)
  }

  /**
   * 获取视频列表（含统计数据）
   * 使用快手创作者数据分析 API (参考蚁小二)
   * POST https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list
   */
  async getVideoList(client: HttpClient, options?: { cursor?: string; pageSize?: number }): Promise<VideoListResult> {
    const cookie = client.getCookieString()
    const page = options?.cursor ? parseInt(options.cursor) : 0
    // The creator analytics endpoint serves at most 10 items per page.
    // Keep this independent from the signed works-list/publishing endpoints.
    const count = Math.min(options?.pageSize || 10, 10)

    // 提取 api_ph token
    const apiPh = this.extractApiPh(cookie)

    const body = {
      orderType: 2,
      sortType: 1,
      type: 0,
      count,
      page,
      'kuaishou.web.cp.api_ph': apiPh
    }

    const response = await client.post<{
      result: number
      data?: {
        photoList?: {
          photoItems: Array<{
            photoId: string
            cover: string
            title: string
            publishTime: number
            video: boolean
            playCount: number
            fpr: number
            commentCount: number
            likeCount: number
            collectCount: number
            followCount: number
          }>
        }
      }
    }>(
      'https://cp.kuaishou.com/rest/cp/creator/analysis/pc/photo/list',
      body,
      {
        headers: {
          referer: 'https://cp.kuaishou.com/article/manage/video',
          Origin: 'https://cp.kuaishou.com',
          'Content-Type': 'application/json;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    )

    logger.info(`[kuaishou] getVideoList response: result=${response.data?.result}, count=${response.data?.data?.photoList?.photoItems?.length || 0}`)

    if (response.data?.result !== 1) {
      throw new Error(`获取视频列表失败: result=${response.data?.result}`)
    }

    const photoItems = response.data.data?.photoList?.photoItems || []

    const items = photoItems.map((photo) => ({
      contentId: photo.photoId,
      title: photo.title,
      coverUrl: photo.cover,
      // Kuaishou returns milliseconds here, while VideoListItem uses seconds.
      publishTime: photo.publishTime > 10_000_000_000
        ? Math.floor(photo.publishTime / 1000)
        : photo.publishTime,
      views: photo.playCount || 0,
      likes: photo.likeCount || 0,
      comments: photo.commentCount || 0,
      shares: 0, // 快手API不返回分享数
      favorites: photo.collectCount || 0
    }))

    return {
      items,
      cursor: String(page + 1),
      hasMore: photoItems.length >= count
    }
  }

  private extractApiPh(cookie: string): string {
    const match = cookie.match(/(?:^|;\s*)kuaishou\.web\.cp\.api_ph=([^;]+)/)
    return match ? match[1] : ''
  }

  private async postKuaishouSignedJson<T>(
    client: HttpClient,
    cookie: string,
    endpoint: string,
    signPath: string,
    body: string,
    headers: Record<string, string>,
    options: { requireSig3?: boolean; action?: string } = {}
  ): Promise<T> {
    const signService = getSignService()
    let signFailureMessage = 'signer 未返回 __NS_sig3'

    try {
      const sig3 = await signService.getSignature(
        'kuaishou',
        cookie,
        JSON.stringify({ url: signPath, body }),
        body,
        client.getAccountId()
      )

      if (sig3) {
        const signedUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}__NS_sig3=${encodeURIComponent(sig3)}`
        logger.info(`[kuaishou] Signed POST ${signPath}: __NS_sig3=yes`)
        const response = await client.post<T>(signedUrl, body, headers)
        return response.data
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('已取消发布')) throw err
      signFailureMessage = message
      logger.warn(`[kuaishou] Signature POST ${signPath} unavailable, trying built-in browser POST: ${message}`)
    }

    const browserResponse = await signService.postKuaishouInBuiltinBrowser(
      cookie,
      endpoint,
      body,
      headers,
      client.getAccountId()
    )
    if (!browserResponse) {
      throw new Error(`快手请求失败：无法生成签名，也无法使用内置浏览器提交 ${signPath}`)
    }
    if (browserResponse.status < 200 || browserResponse.status >= 300) {
      throw new Error(`快手浏览器请求失败：HTTP ${browserResponse.status}，响应=${browserResponse.text.substring(0, 300)}`)
    }
    let browserData: T
    try {
      browserData = JSON.parse(browserResponse.text) as T
    } catch {
      throw new Error(`快手浏览器请求返回非 JSON：${browserResponse.text.substring(0, 300)}`)
    }

    if (options.requireSig3 && !browserResponse.url.includes('__NS_sig3=')) {
      const resultCode = Number((browserData as { result?: unknown })?.result)
      const resultMessage = String(
        (browserData as { message?: unknown; error_msg?: unknown })?.message ||
        (browserData as { message?: unknown; error_msg?: unknown })?.error_msg ||
        ''
      )

      if (resultCode === 1 || isKuaishouRetryLater(resultCode, resultMessage)) {
        logger.warn(
          `[kuaishou] Browser fallback ${signPath} did not expose __NS_sig3, ` +
          `but returned platform response result=${resultCode}, message=${resultMessage || 'N/A'}; continuing`
        )
        return browserData
      }

      throw new Error(
        `快手${options.action || signPath}失败：缺少 __NS_sig3 签名（${signFailureMessage}）。` +
        `浏览器响应=${browserResponse.text.substring(0, 300)}。` +
        '当前网页 API/HTTP 路径必须拿到快手页面生成的 __NS_sig3；请接入能返回 __NS_sig3 的本机 signer，' +
        '或配置快手官方 OpenAPI（FLOW_PUBLISHER_KUAISHOU_OPENAPI_APP_ID / FLOW_PUBLISHER_KUAISHOU_OPENAPI_ACCESS_TOKEN）后重试。'
      )
    }

    return browserData
  }

  private async postKuaishouJsonWithBrowserFallback<T>(
    client: HttpClient,
    cookie: string,
    endpoint: string,
    body: string,
    headers: Record<string, string>,
    action: string
  ): Promise<T> {
    let directFailureMessage = ''
    try {
      const response = await client.post<T>(
        endpoint,
        body,
        headers,
        { timeout: readPositiveIntEnv('FLOW_PUBLISHER_KUAISHOU_UPLOAD_PRE_TIMEOUT_MS', 20_000) }
      )
      return response.data
    } catch (err) {
      const message = describeError(err)
      directFailureMessage = message
      logger.warn(`[kuaishou] ${action} direct HTTP failed, trying authenticated Electron browser POST: ${message}`)
    }

    const browserResponse = await getSignService().postKuaishouInBuiltinBrowser(
      cookie,
      endpoint,
      body,
      headers,
      client.getAccountId()
    )
    if (!browserResponse) {
      throw new Error(
        `快手${action}失败：直接 HTTP 失败（${directFailureMessage || 'unknown'}），且内置浏览器提交不可用`
      )
    }
    if (browserResponse.status < 200 || browserResponse.status >= 300) {
      throw new Error(
        `快手${action}浏览器请求失败：HTTP ${browserResponse.status}，` +
        `直接 HTTP=${directFailureMessage || 'unknown'}，响应=${browserResponse.text.substring(0, 300)}`
      )
    }

    try {
      return JSON.parse(browserResponse.text) as T
    } catch {
      throw new Error(
        `快手${action}浏览器请求返回非 JSON：直接 HTTP=${directFailureMessage || 'unknown'}，` +
        `响应=${browserResponse.text.substring(0, 300)}`
      )
    }
  }

  // computeFileMd5 moved to electron/utils/file-hash.ts (shared utility)

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

  private buildCaption(payload: SubmitContentPayload): string {
    let caption = payload.title || ''
    if (payload.description) {
      caption += ' ' + payload.description
    }
    for (const tag of payload.hashtags || []) {
      caption += ` #${tag} `
    }
    return caption.trim()
  }

}
