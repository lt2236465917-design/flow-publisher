import { chromium, type BrowserContext, type Page, type Route } from 'playwright-core'
import { app, BrowserWindow, session, type Session } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'
import { logger } from '../../utils/logger'
import { hardenPlatformWindow } from '../../security/platform-window-security'
import { summarizePayload } from '../../utils/log-redaction'
import {
  createSignerPreflightError,
  createSignerUnavailableError,
  getPlatformName,
  getSelfHostedSignerUrl,
  isBuiltinLocalSignerEnabled,
  isLegacyExternalSignerEnabled,
  requiresWebSignature,
  shouldRethrowSignError
} from './SignPolicy'

const SIGN_TIMEOUT = 45_000
const SIGN_PREFLIGHT_TIMEOUT = 2_500
const DOUYIN_SIGN_CONTEXT_URL = 'https://creator.douyin.com/creator-micro/content/publish?enter_from=publish_page'
const XHS_SIGN_CONTEXT_URL =
  process.env.FLOW_PUBLISHER_XHS_SIGN_CONTEXT_URL?.trim() ||
  'https://creator.xiaohongshu.com/new/publish'
const XHS_SIGN_CONTEXT_FALLBACK_URLS = [
  XHS_SIGN_CONTEXT_URL,
  'https://creator.xiaohongshu.com/publish/publish?from=menu&target=video',
  'https://creator.xiaohongshu.com/publish/publish',
  'https://creator.xiaohongshu.com/creator/home',
  'https://www.xiaohongshu.com/explore',
  'https://www.xiaohongshu.com/'
].filter((url, index, urls) => urls.indexOf(url) === index)
const REALISTIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.3240.14'

// Legacy yixiaoer external signature server.
const YIXIAOER_SIGN_PORTS: Record<string, string[]> = {
  douyin: ['5041', '5042'],
  kuaishou: ['5004', '5005', '5006', '5007', '5008'],
  xiaohongshu: ['5096'],
  newxiaohongshu: ['5061', '5062', '5063']
}
const YIXIAOER_SIGN_BASE = 'http://qianming.yixiaoer.cn'

export interface SelfHostedSignerHealth {
  available: boolean
  url?: string
  status?: number
  detail?: string
}

export interface WebSignerPreflightResult {
  platform: string
  required: boolean
  mode: 'not-required' | 'self-hosted' | 'built-in-local' | 'legacy-external'
  detail?: string
}

export interface XhsBrowserPostResult {
  status: number
  url: string
  text: string
  error?: string
  signKeys?: string[]
  hasXSCommon?: boolean
  hasRapParam?: boolean
  transport?: string
  pageUrl?: string
  hasWebmsxyw?: boolean
  signedKeys?: string[]
}

/**
 * Signature service.
 *
 * The default path is self-hosted, except Xiaohongshu note creation which uses
 * yixiaoer's `newxiaohongshu` signer format because the current creator page no
 * longer yields the portable X-S-Common header required by the HTTP endpoint.
 */
export class SignService {
  private contexts = new Map<string, BrowserContext>()
  private pages = new Map<string, Page>()
  private electronWindows = new Map<string, BrowserWindow>()
  private electronCookieFingerprints = new Map<string, string>()
  private xhsSignatureQueues = new Map<string, Promise<void>>()
  private initializing = new Map<string, Promise<void>>()
  private cookieFingerprints = new Map<string, string>()
  private fallbackConfirmer: ((platform: string) => Promise<boolean>) | null = null
  private fallbackDecision: boolean | null = null
  private fallbackConfirmation: Promise<boolean> | null = null
  private fallbackGeneration = 0

  /**
   * Set a callback to confirm before falling back to the built-in local signer.
   *
   * If no confirmer is set, built-in local signing is never attempted.
   */
  setFallbackConfirmer(fn: ((platform: string) => Promise<boolean>) | null): void {
    this.fallbackConfirmer = fn
  }

  /**
   * Clear the per-platform fallback confirmation cache.
   * Call this at the start of each publish operation so the user is re-prompted
   * if self-hosted signing fails again for a different publish.
   */
  clearFallbackCache(): void {
    this.fallbackGeneration += 1
    this.fallbackDecision = null
    this.fallbackConfirmation = null
  }

  async checkSelfHostedSignerHealth(timeoutMs = SIGN_PREFLIGHT_TIMEOUT): Promise<SelfHostedSignerHealth> {
    const signerUrl = getSelfHostedSignerUrl()
    if (!signerUrl) {
      return { available: false, detail: 'FLOW_PUBLISHER_SIGNER_URL 已禁用' }
    }

    const baseUrl = signerUrl
      .replace(/\/sign\/?$/, '')
      .replace(/\/$/, '')
    const healthUrl = `${baseUrl}/health`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { Accept: 'application/json, text/plain, */*' },
        signal: controller.signal
      })

      if (response.ok) {
        return { available: true, url: signerUrl, status: response.status }
      }

      // Third-party/self-hosted signers may expose only POST /sign and no health route.
      if (response.status === 404 || response.status === 405) {
        return {
          available: true,
          url: signerUrl,
          status: response.status,
          detail: `/health 返回 HTTP ${response.status}，但 signer 服务可连接`
        }
      }

      return {
        available: false,
        url: signerUrl,
        status: response.status,
        detail: `/health 返回 HTTP ${response.status}`
      }
    } catch (err) {
      return {
        available: false,
        url: signerUrl,
        detail: err instanceof Error ? err.message : String(err)
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async ensureWebSignerReadyForPublish(platform: string): Promise<WebSignerPreflightResult> {
    if (!requiresWebSignature(platform)) {
      return { platform, required: false, mode: 'not-required' }
    }

    const health = await this.checkSelfHostedSignerHealth()
    if (health.available) {
      logger.info(`[sign] ${platform} signer preflight passed via self-hosted signer (${health.url})`)
      return {
        platform,
        required: true,
        mode: 'self-hosted',
        detail: health.detail
      }
    }

    const healthDetail = health.detail || '无法连接 signer 服务'
    logger.warn(`[sign] ${platform} signer preflight: self-hosted signer unavailable (${healthDetail})`)

    if (this.isKuaishouYixiaoerSignerAllowed(platform)) {
      logger.warn('[sign] kuaishou signer preflight will use yixiaoer-compatible __NS_sig3 signer')
      return {
        platform,
        required: true,
        mode: 'legacy-external',
        detail: healthDetail
      }
    }

    if (this.isXhsYixiaoerSignerAllowed(platform)) {
      logger.warn('[sign] xiaohongshu signer preflight will use yixiaoer-compatible newxiaohongshu signer')
      return {
        platform,
        required: true,
        mode: 'legacy-external',
        detail: 'note create 仅发送接口路径和最终请求 body，不发送登录 Cookie'
      }
    }

    if (isLegacyExternalSignerEnabled()) {
      logger.warn(`[sign] ${platform} signer preflight will use explicitly enabled legacy external signer`)
      return {
        platform,
        required: true,
        mode: 'legacy-external',
        detail: healthDetail
      }
    }

    if (platform === 'xiaohongshu') {
      throw createSignerPreflightError(
        platform,
        `${healthDetail}；需要当前小红书创作页生成的 X-s / X-t 与 X-S-Common 或 x-rap-param`
      )
    }

    if (!isBuiltinLocalSignerEnabled()) {
      throw createSignerPreflightError(platform, healthDetail)
    }

    const confirmed = await this.confirmLocalSigningFallback(platform)
    if (!confirmed) {
      const platformName = getPlatformName(platform)
      logger.info(`[sign] ${platform} local signing denied during preflight`)
      throw new Error(`已取消发布：${platformName} 本机 signer 不可用，且你取消了内置本机浏览器签名`)
    }

    logger.warn(`[sign] ${platform} signer preflight allowed built-in local browser signing`)
    return {
      platform,
      required: true,
      mode: 'built-in-local',
      detail: healthDetail
    }
  }

  /**
   * Get the signature for a given request.
   *
   * Order:
   * 1. Self-hosted signer endpoint (default http://127.0.0.1:17321)
   * 2. Kuaishou yixiaoer-compatible sig3 signer (MD5(body), no auth cookie)
   * 3. Built-in local Playwright signer after user confirmation
   * 4. Legacy yixiaoer signer only if explicitly enabled by env var
   *
   * @param body Request body string — used by kuaishou external service (MD5 of body)
   */
  async getSignature(platform: string, cookie: string, data: string, body?: string, accountId?: string): Promise<string> {
    try {
      let signature = ''

      // For douyin, the data parameter IS the full URL to sign
      const urlToSign = platform === 'douyin' ? data : ''

      if (this.isXhsYixiaoerNoteSignerRequired(platform, data)) {
        logger.warn('[sign] Using yixiaoer-compatible newxiaohongshu signer for note create')
        signature = await this.getExternalSignature(platform, cookie, data, body, urlToSign)
        if (!signature || !this.hasCompleteXhsPortableSignature(signature)) {
          throw new Error(
            '小红书签名失败：蚁小二 newxiaohongshu signer 未返回完整的 X-s / X-t / X-S-Common。'
          )
        }
        return signature
      }

      signature = await this.getSelfHostedSignature(platform, cookie, data, body, urlToSign, accountId)

      if (signature) {
        if (platform === 'xiaohongshu' && !this.hasXhsPublishSignatureHeaders(signature, data)) {
          logger.warn('[sign] xiaohongshu self-hosted signature missing usable publish headers')
          if (isLegacyExternalSignerEnabled()) {
            logger.warn('[sign] Trying explicitly enabled legacy external signer after incomplete xiaohongshu self-hosted signature')
            const externalSignature = await this.getExternalSignature(platform, cookie, data, body, urlToSign)
            if (externalSignature) return externalSignature
          }
          throw new Error(
            '小红书签名不完整：当前 signer 未返回 X-s / X-t，或未返回 X-S-Common / x-rap-param。'
          )
        }
        logger.info(`[sign] ${platform} signature from self-hosted signer`)
        return signature
      }

      if (this.isKuaishouYixiaoerSignerAllowed(platform)) {
        logger.warn('[sign] Trying yixiaoer-compatible kuaishou __NS_sig3 signer')
        signature = await this.getExternalSignature(platform, cookie, data, body, urlToSign)
        if (signature) {
          if (platform === 'xiaohongshu' && !this.hasXhsPublishSignatureHeaders(signature, data)) {
            logger.warn('[sign] xiaohongshu legacy external signature missing usable publish headers')
          } else {
            return signature
          }
        }
      }

      if (isLegacyExternalSignerEnabled() && (platform === 'kuaishou' || platform === 'xiaohongshu')) {
        logger.warn(`[sign] Trying explicitly enabled legacy external signer first for ${platform}`)
        signature = await this.getExternalSignature(platform, cookie, data, body, urlToSign)
        if (signature) return signature
      }

      // Priority 2: built-in Playwright-based signing (local fallback)
      // Require user confirmation before using local signing — Playwright-based
      // signing may be detected by platforms and lead to account restrictions.
      if (!isBuiltinLocalSignerEnabled()) {
        logger.warn(`[sign] Built-in local signer disabled for ${platform}`)
      } else {
        if (this.fallbackDecision === false) {
          logger.info(`[sign] Local signing previously denied by user, skipping ${platform}`)
          throw new Error(`已取消发布：${platform} 本机签名服务不可用，且你取消了内置本机浏览器签名`)
        }
        const canUseAuthenticatedElectronSession = Boolean(
          accountId && (platform === 'kuaishou' || platform === 'xiaohongshu')
        )
        if (this.fallbackDecision !== true && !canUseAuthenticatedElectronSession) {
          const confirmed = await this.confirmLocalSigningFallback(platform)
          if (!confirmed) {
            logger.info(`[sign] ${platform} local signing denied by user`)
            throw new Error(`已取消发布：${platform} 本机签名服务不可用，且你取消了内置本机浏览器签名`)
          }
        }

        logger.info(`[sign] Self-hosted signer unavailable for ${platform}, trying built-in local signing...`)
        signature = await this.getBuiltinLocalSignature(platform, cookie, data, body, accountId)

        if (signature) {
          if (platform === 'xiaohongshu' && !this.hasXhsPublishSignatureHeaders(signature, data)) {
            logger.warn('[sign] xiaohongshu built-in local signature uses current creator-page headers without X-S-Common')
            if (!isLegacyExternalSignerEnabled()) return signature
          } else {
            return signature
          }
        }
      }

      if (isLegacyExternalSignerEnabled()) {
        logger.warn(`[sign] Trying explicitly enabled legacy external signer for ${platform}`)
        signature = await this.getExternalSignature(platform, cookie, data, body, urlToSign)
        if (signature) return signature
      }

      throw createSignerUnavailableError(platform)
    } catch (err) {
      if (shouldRethrowSignError(err)) {
        throw err
      }
      logger.error(`[sign] Failed to get signature for ${platform}:`, err)
      return ''
    }
  }

  private hasXhsPublishSignatureHeaders(signature: string, data?: string): boolean {
    try {
      const parsed = this.parseSignatureObject(signature)
      if (!parsed) return false
      const xs = this.getHeaderValue(parsed, 'x-s')
      const xt = this.getHeaderValue(parsed, 'x-t')
      const xsCommon = this.getHeaderValue(parsed, 'x-s-common')
      const rapParam = this.getHeaderValue(parsed, 'x-rap-param')
      let requiresPublishHeader = true
      if (data) {
        try {
          const request = JSON.parse(data) as { body?: string }
          requiresPublishHeader = Boolean(request.body)
        } catch {
          // Keep publish-level validation for unknown payload shapes.
        }
      }
      if (!requiresPublishHeader) return Boolean(xs && xt)
      return Boolean(xs && xt && (xsCommon || rapParam))
    } catch {
      return false
    }
  }

  private hasCompleteXhsPortableSignature(signature: string): boolean {
    const parsed = this.parseSignatureObject(signature)
    if (!parsed) return false
    return Boolean(
      this.getHeaderValue(parsed, 'x-s') &&
      this.getHeaderValue(parsed, 'x-t') &&
      this.getHeaderValue(parsed, 'x-s-common')
    )
  }

  private isXhsYixiaoerNoteSignerRequired(platform: string, data: string): boolean {
    if (!this.isXhsYixiaoerSignerAllowed(platform)) return false
    try {
      const request = JSON.parse(data) as { url?: string; body?: string }
      return request.url === '/web_api/sns/v2/note' && Boolean(request.body)
    } catch {
      return false
    }
  }

  private parseSignatureObject(signature: string): Record<string, string> | null {
    const normalized = signature.trim()
    if (!normalized) return null
    try {
      return JSON.parse(normalized) as Record<string, string>
    } catch {
      try {
        return JSON.parse(normalized.replace(/\\/g, '"')) as Record<string, string>
      } catch {
        return null
      }
    }
  }

  async getBuiltinLocalSignature(
    platform: string,
    cookie: string,
    data: string,
    body?: string,
    accountId?: string
  ): Promise<string> {
    switch (platform) {
      case 'douyin':
        return await this.getDouyinSignature(cookie, data, body)
      case 'xiaohongshu':
        return await this.getXhsSignatureInElectron(cookie, data, accountId)
      case 'kuaishou':
        return await this.getKuaishouSignatureInElectron(cookie, data, accountId)
      default:
        logger.warn(`[sign] No built-in signature implementation for platform: ${platform}`)
        return ''
    }
  }

  async postKuaishouInBuiltinBrowser(
    cookie: string,
    url: string,
    body: string,
    headers: Record<string, string> = {},
    accountId?: string
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    if (!await this.ensureBuiltinBrowserSubmitAllowed('kuaishou', accountId)) return null

    const win = await this.getOrCreateElectronWindow(
      'kuaishou',
      cookie,
      'https://cp.kuaishou.com/article/publish/video',
      accountId
    )
    return await this.postJsonFromElectronWindow('kuaishou', win, url, body, headers)
  }

  async postXhsInBuiltinBrowser(
    cookie: string,
    urlPath: string,
    body: string,
    headers: Record<string, string> = {},
    accountId?: string
  ): Promise<XhsBrowserPostResult | null> {
    if (!await this.ensureBuiltinBrowserSubmitAllowed('xiaohongshu', accountId)) return null

    const win = await this.getOrCreateElectronWindow(
      'xiaohongshu',
      cookie,
      XHS_SIGN_CONTEXT_URL,
      accountId
    )
    const requestUrl = urlPath.startsWith('http')
      ? urlPath
      : `https://edith.xiaohongshu.com${urlPath}`
    const normalizedPath = urlPath.startsWith('http')
      ? new URL(urlPath).pathname
      : urlPath

    return await this.postXhsJsonFromElectronWindow(win, requestUrl, normalizedPath, body, headers)
  }

  async getXhsInBuiltinBrowser(
    cookie: string,
    urlPath: string,
    headers: Record<string, string> = {},
    accountId?: string
  ): Promise<XhsBrowserPostResult | null> {
    if (!await this.ensureBuiltinBrowserSubmitAllowed('xiaohongshu', accountId)) return null

    const win = await this.getOrCreateElectronWindow(
      'xiaohongshu',
      cookie,
      XHS_SIGN_CONTEXT_URL,
      accountId
    )
    const requestUrl = urlPath.startsWith('http')
      ? urlPath
      : `https://edith.xiaohongshu.com${urlPath}`
    const parsedUrl = new URL(requestUrl)
    const signPath = `${parsedUrl.pathname}${parsedUrl.search}`
    const matchPath = parsedUrl.pathname

    return await this.getXhsJsonFromElectronWindow(win, requestUrl, signPath, matchPath, headers)
  }

  async ensureDouyinSignContext(cookie: string): Promise<void> {
    await this.getOrCreatePage('douyin', cookie, DOUYIN_SIGN_CONTEXT_URL)
  }

  async getDouyinSignedBrowserRequest(
    cookie: string,
    url: string,
    body: string,
    headers: Record<string, string> = {}
  ): Promise<{ url: string; headers: Record<string, string> } | null> {
    const page = await this.getOrCreatePage('douyin', cookie, DOUYIN_SIGN_CONTEXT_URL)
    const urlToTrigger = url.includes('a_bogus=')
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}a_bogus=`

    let targetPath = ''
    try {
      targetPath = new URL(urlToTrigger).pathname
    } catch {
      targetPath = '/web/api/media/aweme/create_v2/'
    }

    let captured: { url: string; headers: Record<string, string> } | null = null
    const capture = (requestUrl: string, requestHeaders: Record<string, string>) => {
      const currentHasClientData = Boolean(captured?.headers['bd-ticket-guard-client-data'])
      const nextHasClientData = Boolean(requestHeaders['bd-ticket-guard-client-data'])
      const currentHasABogus = Boolean(captured?.url.includes('a_bogus='))
      const nextHasABogus = requestUrl.includes('a_bogus=')

      if (!captured || (!currentHasClientData && nextHasClientData) || (!currentHasABogus && nextHasABogus)) {
        captured = { url: requestUrl, headers: requestHeaders }
      }
    }

    const routeHandler = async (route: Route) => {
      const request = route.request()
      const requestUrl = request.url()
      let isTargetRequest = requestUrl.includes('/web/api/media/aweme/create_v2/')
      try {
        isTargetRequest = new URL(requestUrl).pathname === targetPath
      } catch {
        // Keep the substring match fallback above.
      }

      if (isTargetRequest) {
        capture(requestUrl, request.headers())
      }

      if (isTargetRequest) {
        await route.abort()
        return
      }

      await route.continue()
    }

    try {
      await page.route('**/*', routeHandler)

      await page.waitForTimeout(1000)
      await this.triggerDouyinBrowserPost(page, urlToTrigger, body, headers, 'xhr')
      await page.waitForTimeout(2500)

      if (!captured) {
        await this.triggerDouyinBrowserPost(page, urlToTrigger, body, headers, 'fetch')
        await page.waitForTimeout(2500)
      }

      const capturedRequest = captured as { url: string; headers: Record<string, string> } | null
      if (!capturedRequest) {
        logger.warn('[sign] Douyin browser request was not captured for create_v2')
        return null
      }

      const headerNames = Object.keys(capturedRequest.headers)
        .filter((name) => name.startsWith('bd-ticket-guard-') || name.startsWith('sec-') || name === 'user-agent' || name === 'x-secsdk-csrf-token')
        .sort()
      logger.info(
        `[sign] Douyin browser request captured: a_bogus=${capturedRequest.url.includes('a_bogus=') ? 'yes' : 'no'}, ` +
        `clientData=${capturedRequest.headers['bd-ticket-guard-client-data'] ? 'yes' : 'no'}, headers=${headerNames.join(',') || 'none'}`
      )

      return capturedRequest
    } catch (err) {
      logger.warn('[sign] Douyin browser request capture failed:', err)
      return null
    } finally {
      try { await page.unroute('**/*', routeHandler) } catch {
        // The page may have been reset after a signing failure.
      }
    }
  }

  async submitDouyinInBuiltinBrowser(
    cookie: string,
    url: string,
    body: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    if (!isBuiltinLocalSignerEnabled()) {
      logger.info('[sign] Built-in local signer disabled for douyin, skipping built-in browser submit')
      return null
    }

    const page = await this.getOrCreatePage('douyin', cookie, DOUYIN_SIGN_CONTEXT_URL)
    const urlToSubmit = url.includes('a_bogus=')
      ? url
      : `${url}${url.includes('?') ? '&' : '?'}a_bogus=`

    try {
      const result = await page.evaluate(
        async ({ initialUrl, body, headers }) => {
          function getCookie(name: string): string {
            const parts = document.cookie.split(';')
            for (const part of parts) {
              const trimmed = part.trim()
              const separator = trimmed.indexOf('=')
              if (separator <= 0) continue
              if (trimmed.slice(0, separator) === name) {
                return trimmed.slice(separator + 1)
              }
            }
            return ''
          }

          try {
            const target = new URL(initialUrl)
            const pageMsToken = getCookie('msToken')
            if (pageMsToken) target.searchParams.set('msToken', pageMsToken)
            if (!target.searchParams.has('a_bogus')) target.searchParams.append('a_bogus', '')

            const safeHeaders: Record<string, string> = {}
            for (const [name, value] of Object.entries(headers)) {
              const lower = name.toLowerCase()
              if (!value || ['cookie', 'host', 'content-length', 'user-agent', 'origin', 'referer'].includes(lower)) {
                continue
              }
              safeHeaders[name] = value
            }
            if (!Object.keys(safeHeaders).some((name) => name.toLowerCase() === 'content-type')) {
              safeHeaders['Content-Type'] = 'application/json'
            }

            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 45_000)
            const response = await fetch(target.toString(), {
              method: 'POST',
              credentials: 'include',
              headers: safeHeaders,
              body,
              signal: controller.signal
            })
            clearTimeout(timer)

            return {
              status: response.status,
              url: response.url,
              text: await response.text()
            }
          } catch (err) {
            return {
              status: 0,
              url: '',
              text: '',
              error: String(err && err instanceof Error ? err.message : err)
            }
          }
        },
        { initialUrl: urlToSubmit, body, headers }
      ) as { status?: number; url?: string; text?: string; error?: string }

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      logger.info(
        `[sign] Douyin built-in browser submit returned status=${status}, ` +
        `a_bogus=${this.hasNonEmptyABogus(responseUrl) ? 'yes' : responseUrl.includes('a_bogus=') ? 'empty' : 'no'}, ` +
        `textLength=${text.length}${result?.error ? `, error=${result.error}` : ''}`
      )
      return { status, url: responseUrl, text, error: result?.error }
    } catch (err) {
      logger.warn('[sign] Douyin built-in browser submit failed:', err)
      return null
    }
  }

  async submitDouyinInElectronSession(
    accountId: string,
    cookie: string,
    url: string,
    body: string,
    csrfToken: string
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    if (!accountId) return null

    const partition = `persist:auth-${accountId}`
    const ses = session.fromPartition(partition)
    await this.syncCookiesToElectronSession(ses, 'douyin', cookie)

    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition
      }
    })
    hardenPlatformWindow(win, 'douyin')

    try {
      await win.loadURL(DOUYIN_SIGN_CONTEXT_URL)
      await new Promise((resolve) => setTimeout(resolve, 5000))

      const result = await win.webContents.executeJavaScript(`
        (async function() {
          const initialUrl = ${JSON.stringify(url)};
          const body = ${JSON.stringify(body)};
          const csrfToken = ${JSON.stringify(csrfToken)};

          function getCookie(name) {
            const parts = document.cookie.split(';');
            for (const part of parts) {
              const trimmed = part.trim();
              const separator = trimmed.indexOf('=');
              if (separator <= 0) continue;
              if (trimmed.slice(0, separator) === name) {
                return trimmed.slice(separator + 1);
              }
            }
            return '';
          }

          try {
            const target = new URL(initialUrl);
            const pageMsToken = getCookie('msToken');
            if (pageMsToken) target.searchParams.set('msToken', pageMsToken);
            if (!target.searchParams.has('a_bogus')) target.searchParams.append('a_bogus', '');

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45000);
            const response = await fetch(target.toString(), {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'x-secsdk-csrf-token': csrfToken
              },
              body,
              signal: controller.signal
            });
            clearTimeout(timer);
            const text = await response.text();
            return {
              status: response.status,
              url: response.url,
              text
            };
          } catch (err) {
            return {
              status: 0,
              url: '',
              text: '',
              error: String(err && err.message ? err.message : err)
            };
          }
        })()
      `, true) as { status?: number; url?: string; text?: string; error?: string }

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      logger.info(
        `[sign] Douyin Electron-session submit returned status=${status}, ` +
        `a_bogus=${this.hasNonEmptyABogus(responseUrl) ? 'yes' : responseUrl.includes('a_bogus=') ? 'empty' : 'no'}, ` +
        `textLength=${text.length}${result?.error ? `, error=${result.error}` : ''}`
      )
      return { status, url: responseUrl, text, error: result?.error }
    } catch (err) {
      logger.warn('[sign] Douyin Electron-session submit failed:', err)
      return null
    } finally {
      if (!win.isDestroyed()) {
        win.close()
      }
    }
  }

  private async confirmLocalSigningFallback(platform: string): Promise<boolean> {
    if (this.fallbackDecision !== null) return this.fallbackDecision
    if (this.fallbackConfirmation) return this.fallbackConfirmation

    if (!this.fallbackConfirmer) {
      // No confirmer set (e.g. scheduled task) — never use local signing
      logger.info(`[sign] ${platform} no confirmer set, skipping local signing for safety`)
      throw createSignerUnavailableError(platform)
    }

    logger.info(`[sign] ${platform} asking user for local signing confirmation`)
    const generation = this.fallbackGeneration
    this.fallbackConfirmation = this.fallbackConfirmer(platform)
      .then((confirmed) => {
        if (this.fallbackGeneration === generation) {
          this.fallbackDecision = confirmed
        }
        return confirmed
      })
      .finally(() => {
        if (this.fallbackGeneration === generation) {
          this.fallbackConfirmation = null
        }
      })

    return this.fallbackConfirmation
  }

  private async ensureBuiltinBrowserSubmitAllowed(platform: string, accountId?: string): Promise<boolean> {
    if (!isBuiltinLocalSignerEnabled()) {
      logger.info(`[sign] Built-in local signer disabled for ${platform}, skipping built-in browser submit`)
      return false
    }

    if (this.fallbackDecision === true) return true
    if (accountId && (platform === 'kuaishou' || platform === 'xiaohongshu')) {
      logger.info(`[sign] Using authenticated Electron session for ${platform} built-in browser submit`)
      return true
    }

    const confirmed = await this.confirmLocalSigningFallback(platform)
    if (!confirmed) {
      throw new Error(`已取消发布：${platform} 本机签名服务不可用，且你取消了内置本机浏览器签名`)
    }

    return true
  }

  private async postJsonFromPage(
    platform: string,
    page: Page,
    url: string,
    body: string,
    headers: Record<string, string>
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    try {
      const result = await page.evaluate(
        async ({ url, body, headers }) => {
          const forbiddenHeaders = new Set([
            'accept-encoding',
            'connection',
            'content-length',
            'cookie',
            'host',
            'origin',
            'referer',
            'sec-ch-ua',
            'sec-ch-ua-mobile',
            'sec-ch-ua-platform',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
            'user-agent'
          ])

          const safeHeaders: Record<string, string> = {}
          for (const [name, value] of Object.entries(headers)) {
            const lower = name.toLowerCase()
            if (!value || forbiddenHeaders.has(lower) || lower === 'x-rap-param') continue
            safeHeaders[name] = value
          }
          if (!Object.keys(safeHeaders).some((name) => name.toLowerCase() === 'content-type')) {
            safeHeaders['Content-Type'] = 'application/json;charset=UTF-8'
          }

          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 45_000)
            const response = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: safeHeaders,
              body,
              signal: controller.signal
            })
            clearTimeout(timer)

            return {
              status: response.status,
              url: response.url,
              text: await response.text()
            }
          } catch (err) {
            return {
              status: 0,
              url: '',
              text: '',
              error: String(err && err instanceof Error ? err.message : err)
            }
          }
        },
        { url, body, headers }
      ) as { status?: number; url?: string; text?: string; error?: string }

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      logger.info(
        `[sign] ${platform} built-in browser POST returned status=${status}, ` +
        `sig3=${responseUrl.includes('__NS_sig3=') ? 'yes' : 'no'}, textLength=${text.length}` +
        `${result?.error ? `, error=${result.error}` : ''}`
      )
      return { status, url: responseUrl, text, error: result?.error }
    } catch (err) {
      logger.warn(`[sign] ${platform} built-in browser POST failed:`, err)
      return null
    }
  }

  private async postXhsJsonFromPage(
    page: Page,
    requestUrl: string,
    urlPath: string,
    body: string,
    headers: Record<string, string>
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    try {
      const result = await page.evaluate(
        async ({ requestUrl, urlPath, body, headers }) => {
          const forbiddenHeaders = new Set([
            'accept-encoding',
            'connection',
            'content-length',
            'cookie',
            'host',
            'origin',
            'referer',
            'sec-ch-ua',
            'sec-ch-ua-mobile',
            'sec-ch-ua-platform',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
            'user-agent'
          ])

          const safeHeaders: Record<string, string> = {}
          for (const [name, value] of Object.entries(headers)) {
            const lower = name.toLowerCase()
            if (!value || forbiddenHeaders.has(lower)) continue
            safeHeaders[name] = value
          }

          const win = window as unknown as Record<string, unknown>
          if (typeof win._webmsxyw === 'function') {
            try {
              const bodyValue = (() => {
                if (!body) return undefined
                try { return JSON.parse(body) } catch { return body }
              })()
              const signer = win._webmsxyw as (path: string, data?: unknown) => unknown
              let signed = signer(urlPath, bodyValue)
              if (!signed) {
                const legacyPayload = body
                  ? JSON.stringify([urlPath, encodeURIComponent(body)])
                  : JSON.stringify([urlPath])
                signed = (win._webmsxyw as (payload: string) => unknown)(legacyPayload)
              }
              if (typeof signed === 'string') {
                safeHeaders['X-s'] = signed
                safeHeaders['X-t'] = String(Date.now())
              }
              if (signed && typeof signed === 'object') {
                for (const [name, value] of Object.entries(signed)) {
                  if (value) safeHeaders[name] = String(value)
                }
              }
            } catch {
              // The response status below is more useful than surfacing this here.
            }
          }

          if (!Object.keys(safeHeaders).some((name) => name.toLowerCase() === 'content-type')) {
            safeHeaders['Content-Type'] = 'application/json;charset=UTF-8'
          }

          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), 45_000)
            const response = await fetch(requestUrl, {
              method: 'POST',
              credentials: 'include',
              headers: safeHeaders,
              body,
              signal: controller.signal
            })
            clearTimeout(timer)

            return {
              status: response.status,
              url: response.url,
              text: await response.text(),
              signKeys: Object.keys(safeHeaders).filter((name) => name.toLowerCase().startsWith('x-'))
            }
          } catch (err) {
            return {
              status: 0,
              url: '',
              text: '',
              error: String(err && err instanceof Error ? err.message : err),
              signKeys: Object.keys(safeHeaders).filter((name) => name.toLowerCase().startsWith('x-'))
            }
          }
        },
        { requestUrl, urlPath, body, headers }
      ) as { status?: number; url?: string; text?: string; error?: string; signKeys?: string[] }

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      logger.info(
        `[sign] xiaohongshu built-in browser POST returned status=${status}, ` +
        `signKeys=${(result?.signKeys || []).join(',') || 'none'}, textLength=${text.length}` +
        `${result?.error ? `, error=${result.error}` : ''}`
      )
      return { status, url: responseUrl, text, error: result?.error }
    } catch (err) {
      logger.warn('[sign] xiaohongshu built-in browser POST failed:', err)
      return null
    }
  }

  private async postJsonFromElectronWindow(
    platform: string,
    win: BrowserWindow,
    url: string,
    body: string,
    headers: Record<string, string>
  ): Promise<{ status: number; url: string; text: string; error?: string } | null> {
    try {
      const result = await win.webContents.executeJavaScript(`
        (async function() {
          const url = ${JSON.stringify(url)};
          const body = ${JSON.stringify(body)};
          const headers = ${JSON.stringify(headers)};
          const forbiddenHeaders = new Set([
            'accept-encoding',
            'connection',
            'content-length',
            'cookie',
            'host',
            'origin',
            'referer',
            'sec-ch-ua',
            'sec-ch-ua-mobile',
            'sec-ch-ua-platform',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
            'user-agent'
          ]);

          const safeHeaders = {};
          for (const [name, value] of Object.entries(headers || {})) {
            const lower = String(name).toLowerCase();
            if (!value || forbiddenHeaders.has(lower) || lower === 'x-rap-param') continue;
            safeHeaders[name] = value;
          }
          if (!Object.keys(safeHeaders).some((name) => String(name).toLowerCase() === 'content-type')) {
            safeHeaders['Content-Type'] = 'application/json;charset=UTF-8';
          }

          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45000);
            const response = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: safeHeaders,
              body,
              signal: controller.signal
            });
            clearTimeout(timer);
            return {
              status: response.status,
              url: response.url,
              text: await response.text()
            };
          } catch (err) {
            return {
              status: 0,
              url: '',
              text: '',
              error: String(err && err.message ? err.message : err)
            };
          }
        })()
      `, true) as { status?: number; url?: string; text?: string; error?: string }

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      logger.info(
        `[sign] ${platform} Electron browser POST returned status=${status}, ` +
        `sig3=${responseUrl.includes('__NS_sig3=') ? 'yes' : 'no'}, textLength=${text.length}` +
        `${result?.error ? `, error=${result.error}` : ''}`
      )
      return { status, url: responseUrl, text, error: result?.error }
    } catch (err) {
      logger.warn(`[sign] ${platform} Electron browser POST failed:`, err)
      return null
    }
  }

  private async getXhsJsonFromElectronWindow(
    win: BrowserWindow,
    requestUrl: string,
    signPath: string,
    matchPath: string,
    headers: Record<string, string>
  ): Promise<XhsBrowserPostResult | null> {
    const dbg = win.webContents.debugger
    const attachedByUs = !dbg.isAttached()
    const capturedXHeaders: Record<string, string> = {}
    let fetchEnabled = false

    const captureListener = async (_event: unknown, method: string, params: any) => {
      if (method !== 'Fetch.requestPaused') return

      try {
        const request = params?.request || {}
        const requestUrlValue = String(request.url || '')
        const requestMethod = String(request.method || '').toUpperCase()
        const requestHeaders = request.headers || {}
        let isTarget = requestUrlValue.includes(matchPath)
        try {
          isTarget = new URL(requestUrlValue).pathname === matchPath
        } catch {
          // Keep substring fallback for opaque request URLs.
        }

        if (isTarget && requestMethod !== 'OPTIONS') {
          const customHeaders = Object.keys(requestHeaders).filter((name) => name.toLowerCase().startsWith('x-'))
          if (customHeaders.length > 0) {
            for (const name of customHeaders) {
              const value = this.getHeaderValue(requestHeaders, name)
              if (value) capturedXHeaders[name] = value
            }
            logger.info(
              `[sign] xiaohongshu Electron captured outgoing ${requestMethod || 'request'} x-headers: ` +
              `${customHeaders.join(', ')}`
            )
          }
        }
      } finally {
        try {
          await dbg.sendCommand('Fetch.continueRequest', {
            requestId: params.requestId
          })
        } catch {
          // The request may already be gone if the page navigated.
        }
      }
    }

    try {
      if (attachedByUs) {
        dbg.attach('1.3')
      }
      dbg.on('message', captureListener)
      await dbg.sendCommand('Fetch.enable', {
        patterns: [
          { urlPattern: '*://edith.xiaohongshu.com/*', requestStage: 'Request' },
          { urlPattern: '*://creator.xiaohongshu.com/*', requestStage: 'Request' }
        ]
      })
      fetchEnabled = true

      const result = await win.webContents.executeJavaScript(`
        (async function() {
          const requestUrl = ${JSON.stringify(requestUrl)};
          const signPath = ${JSON.stringify(signPath)};
          const headers = ${JSON.stringify(headers)};
          const diagnostics = {
            pageUrl: String(location.href || ''),
            hasWebmsxyw: typeof window._webmsxyw === 'function',
            signedKeys: []
          };
          const forbiddenHeaders = new Set([
            'accept-encoding',
            'connection',
            'content-length',
            'content-type',
            'cookie',
            'host',
            'origin',
            'referer',
            'sec-ch-ua',
            'sec-ch-ua-mobile',
            'sec-ch-ua-platform',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
            'user-agent'
          ]);

          const safeHeaders = {};
          for (const [name, value] of Object.entries(headers || {})) {
            const lower = String(name).toLowerCase();
            if (!value || forbiddenHeaders.has(lower)) continue;
            safeHeaders[name] = value;
          }

          if (typeof window._webmsxyw === 'function') {
            try {
              let signed = window._webmsxyw(signPath, undefined);
              if (!signed) {
                signed = window._webmsxyw(JSON.stringify([signPath])) || {};
              }
              if (typeof signed === 'string') {
                safeHeaders['X-s'] = signed;
                safeHeaders['X-t'] = String(Date.now());
                diagnostics.signedKeys = ['X-s', 'X-t'];
              } else if (signed && typeof signed === 'object') {
                diagnostics.signedKeys = Object.keys(signed);
                for (const [name, value] of Object.entries(signed)) {
                  if (value) safeHeaders[name] = String(value);
                }
              }
            } catch {}
          }

          const signKeys = function() {
            return Object.keys(safeHeaders).filter((name) => String(name).toLowerCase().startsWith('x-'));
          };

          const sendWithFetch = async function() {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45000);
            try {
              const response = await fetch(requestUrl, {
                method: 'GET',
                credentials: 'include',
                headers: safeHeaders,
                signal: controller.signal
              });
              clearTimeout(timer);
              return {
                status: response.status,
                url: response.url,
                text: await response.text(),
                signKeys: signKeys(),
                transport: 'fetch',
                ...diagnostics
              };
            } catch (err) {
              clearTimeout(timer);
              return {
                status: 0,
                url: '',
                text: '',
                error: String(err && err.message ? err.message : err),
                signKeys: signKeys(),
                transport: 'fetch',
                ...diagnostics
              };
            }
          };

          const sendWithXhr = function() {
            return new Promise(function(resolve) {
              try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', requestUrl, true);
                xhr.withCredentials = true;
                xhr.timeout = 45000;
                for (const [name, value] of Object.entries(safeHeaders)) {
                  if (value) xhr.setRequestHeader(name, String(value));
                }
                xhr.onload = function() {
                  resolve({
                    status: xhr.status,
                    url: xhr.responseURL || requestUrl,
                    text: xhr.responseText || '',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.onerror = function() {
                  resolve({
                    status: 0,
                    url: requestUrl,
                    text: '',
                    error: 'XMLHttpRequest network error',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.ontimeout = function() {
                  resolve({
                    status: 0,
                    url: requestUrl,
                    text: '',
                    error: 'XMLHttpRequest timeout',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.send();
              } catch (err) {
                resolve({
                  status: 0,
                  url: requestUrl,
                  text: '',
                  error: String(err && err.message ? err.message : err),
                  signKeys: signKeys(),
                  transport: 'xhr',
                  ...diagnostics
                });
              }
            });
          };

          const fetchResult = await sendWithFetch();
          if (fetchResult.status === 403 || fetchResult.status === 406 || fetchResult.status === 0) {
            const xhrResult = await sendWithXhr();
            if (xhrResult && xhrResult.status > 0) return xhrResult;
          }
          return fetchResult;
        })()
      `, true) as XhsBrowserPostResult

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      const signKeyMap = new Map<string, string>()
      for (const name of result?.signKeys || []) {
        signKeyMap.set(name.toLowerCase(), name)
      }
      for (const name of Object.keys(capturedXHeaders)) {
        signKeyMap.set(name.toLowerCase(), name)
      }
      const signKeys = Array.from(signKeyMap.values())
      const hasXSCommon = signKeys.some((name) => name.toLowerCase() === 'x-s-common')
      const hasRapParam = signKeys.some((name) => name.toLowerCase() === 'x-rap-param')
      logger.info(
        `[sign] xiaohongshu Electron browser GET returned status=${status}, ` +
        `transport=${result?.transport || 'unknown'}, ` +
        `signKeys=${signKeys.join(',') || 'none'}, ` +
        `X-S-Common=${hasXSCommon ? 'yes' : 'no'}, ` +
        `x-rap-param=${hasRapParam ? 'yes' : 'no'}, ` +
        `_webmsxyw=${result?.hasWebmsxyw ? 'yes' : 'no'}, ` +
        `signedKeys=${result?.signedKeys?.join(',') || 'none'}, ` +
        `pageUrl=${result?.pageUrl || 'unknown'}, textLength=${text.length}` +
        `${result?.error ? `, error=${result.error}` : ''}`
      )
      return {
        status,
        url: responseUrl,
        text,
        error: result?.error,
        signKeys,
        hasXSCommon,
        hasRapParam,
        transport: result?.transport,
        pageUrl: result?.pageUrl,
        hasWebmsxyw: result?.hasWebmsxyw,
        signedKeys: result?.signedKeys
      }
    } catch (err) {
      logger.warn('[sign] xiaohongshu Electron browser GET failed:', err)
      return null
    } finally {
      if (fetchEnabled) {
        try { await dbg.sendCommand('Fetch.disable') } catch {
          // Debugger may already be detached if the hidden window navigated.
        }
      }
      dbg.removeListener('message', captureListener)
      if (attachedByUs && dbg.isAttached()) {
        try { dbg.detach() } catch {
          // Detach is best-effort during cleanup.
        }
      }
    }
  }

  private async postXhsJsonFromElectronWindow(
    win: BrowserWindow,
    requestUrl: string,
    urlPath: string,
    body: string,
    headers: Record<string, string>
  ): Promise<XhsBrowserPostResult | null> {
    const dbg = win.webContents.debugger
    const attachedByUs = !dbg.isAttached()
    const capturedXHeaders: Record<string, string> = {}
    let fetchEnabled = false

    const captureListener = async (_event: unknown, method: string, params: any) => {
      if (method !== 'Fetch.requestPaused') return

      try {
        const request = params?.request || {}
        const requestUrlValue = String(request.url || '')
        const requestMethod = String(request.method || '').toUpperCase()
        const headers = request.headers || {}
        let isTarget = requestUrlValue.includes(urlPath)
        try {
          isTarget = new URL(requestUrlValue).pathname === urlPath
        } catch {
          // Keep substring fallback for opaque request URLs.
        }

        if (isTarget && requestMethod !== 'OPTIONS') {
          const customHeaders = Object.keys(headers).filter((name) => name.toLowerCase().startsWith('x-'))
          if (customHeaders.length > 0) {
            for (const name of customHeaders) {
              const value = this.getHeaderValue(headers, name)
              if (value) capturedXHeaders[name] = value
            }
            logger.info(
              `[sign] xiaohongshu Electron captured outgoing ${requestMethod || 'request'} x-headers: ` +
              `${customHeaders.join(', ')}`
            )
          }
        }
      } finally {
        try {
          await dbg.sendCommand('Fetch.continueRequest', {
            requestId: params.requestId
          })
        } catch {
          // The request may already be gone if the page navigated.
        }
      }
    }

    try {
      if (attachedByUs) {
        dbg.attach('1.3')
      }
      dbg.on('message', captureListener)
      await dbg.sendCommand('Fetch.enable', {
        patterns: [
          { urlPattern: '*://edith.xiaohongshu.com/*', requestStage: 'Request' },
          { urlPattern: '*://creator.xiaohongshu.com/*', requestStage: 'Request' }
        ]
      })
      fetchEnabled = true

      const result = await win.webContents.executeJavaScript(`
        (async function() {
          const requestUrl = ${JSON.stringify(requestUrl)};
          const urlPath = ${JSON.stringify(urlPath)};
          const body = ${JSON.stringify(body)};
          const headers = ${JSON.stringify(headers)};
          const diagnostics = {
            pageUrl: String(location.href || ''),
            hasWebmsxyw: typeof window._webmsxyw === 'function',
            signedKeys: []
          };
          const forbiddenHeaders = new Set([
            'accept-encoding',
            'connection',
            'content-length',
            'cookie',
            'host',
            'origin',
            'referer',
            'sec-ch-ua',
            'sec-ch-ua-mobile',
            'sec-ch-ua-platform',
            'sec-fetch-dest',
            'sec-fetch-mode',
            'sec-fetch-site',
            'user-agent'
          ]);

          const safeHeaders = {};
          for (const [name, value] of Object.entries(headers || {})) {
            const lower = String(name).toLowerCase();
            if (!value || forbiddenHeaders.has(lower)) continue;
            safeHeaders[name] = value;
          }

          if (typeof window._webmsxyw === 'function') {
            try {
              const bodyValue = (function() {
                if (!body) return undefined;
                try { return JSON.parse(body); } catch (err) { return body; }
              })();
              let signed = window._webmsxyw(urlPath, bodyValue);
              if (!signed) {
                const legacyPayload = body
                  ? JSON.stringify([urlPath, encodeURIComponent(body)])
                  : JSON.stringify([urlPath]);
                signed = window._webmsxyw(legacyPayload) || {};
              }
              if (typeof signed === 'string') {
                safeHeaders['X-s'] = signed;
                safeHeaders['X-t'] = String(Date.now());
                diagnostics.signedKeys = ['X-s', 'X-t'];
              } else if (signed && typeof signed === 'object') {
                diagnostics.signedKeys = Object.keys(signed);
                for (const [name, value] of Object.entries(signed)) {
                  if (value) safeHeaders[name] = String(value);
                }
              }
            } catch {}
          }

          if (!Object.keys(safeHeaders).some((name) => String(name).toLowerCase() === 'content-type')) {
            safeHeaders['Content-Type'] = 'application/json;charset=UTF-8';
          }

          const signKeys = function() {
            return Object.keys(safeHeaders).filter((name) => String(name).toLowerCase().startsWith('x-'));
          };

          const sendWithFetch = async function() {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 45000);
            try {
              const response = await fetch(requestUrl, {
                method: 'POST',
                credentials: 'include',
                headers: safeHeaders,
                body,
                signal: controller.signal
              });
              clearTimeout(timer);
              return {
                status: response.status,
                url: response.url,
                text: await response.text(),
                signKeys: signKeys(),
                transport: 'fetch',
                ...diagnostics
              };
            } catch (err) {
              clearTimeout(timer);
              return {
                status: 0,
                url: '',
                text: '',
                error: String(err && err.message ? err.message : err),
                signKeys: signKeys(),
                transport: 'fetch',
                ...diagnostics
              };
            }
          };

          const sendWithXhr = function() {
            return new Promise(function(resolve) {
              try {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', requestUrl, true);
                xhr.withCredentials = true;
                xhr.timeout = 45000;
                for (const [name, value] of Object.entries(safeHeaders)) {
                  if (value) xhr.setRequestHeader(name, String(value));
                }
                xhr.onload = function() {
                  resolve({
                    status: xhr.status,
                    url: xhr.responseURL || requestUrl,
                    text: xhr.responseText || '',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.onerror = function() {
                  resolve({
                    status: 0,
                    url: requestUrl,
                    text: '',
                    error: 'XMLHttpRequest network error',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.ontimeout = function() {
                  resolve({
                    status: 0,
                    url: requestUrl,
                    text: '',
                    error: 'XMLHttpRequest timeout',
                    signKeys: signKeys(),
                    transport: 'xhr',
                    ...diagnostics
                  });
                };
                xhr.send(body || null);
              } catch (err) {
                resolve({
                  status: 0,
                  url: requestUrl,
                  text: '',
                  error: String(err && err.message ? err.message : err),
                  signKeys: signKeys(),
                  transport: 'xhr',
                  ...diagnostics
                });
              }
            });
          };

          const fetchResult = await sendWithFetch();
          if (fetchResult.status === 403 || fetchResult.status === 406) {
            const xhrResult = await sendWithXhr();
            if (xhrResult && xhrResult.status > 0) return xhrResult;
          }
          return fetchResult;
        })()
      `, true) as XhsBrowserPostResult

      const status = Number(result?.status || 0)
      const responseUrl = String(result?.url || '')
      const text = String(result?.text || '')
      const signKeyMap = new Map<string, string>()
      for (const name of result?.signKeys || []) {
        signKeyMap.set(name.toLowerCase(), name)
      }
      for (const name of Object.keys(capturedXHeaders)) {
        signKeyMap.set(name.toLowerCase(), name)
      }
      const signKeys = Array.from(signKeyMap.values())
      const hasXSCommon = signKeys.some((name) => name.toLowerCase() === 'x-s-common')
      const hasRapParam = signKeys.some((name) => name.toLowerCase() === 'x-rap-param')
      logger.info(
        `[sign] xiaohongshu Electron browser POST returned status=${status}, ` +
        `transport=${result?.transport || 'unknown'}, ` +
        `signKeys=${signKeys.join(',') || 'none'}, ` +
        `X-S-Common=${hasXSCommon ? 'yes' : 'no'}, ` +
        `x-rap-param=${hasRapParam ? 'yes' : 'no'}, ` +
        `_webmsxyw=${result?.hasWebmsxyw ? 'yes' : 'no'}, ` +
        `signedKeys=${result?.signedKeys?.join(',') || 'none'}, ` +
        `pageUrl=${result?.pageUrl || 'unknown'}, textLength=${text.length}` +
        `${result?.error ? `, error=${result.error}` : ''}`
      )
      return {
        status,
        url: responseUrl,
        text,
        error: result?.error,
        signKeys,
        hasXSCommon,
        hasRapParam,
        transport: result?.transport,
        pageUrl: result?.pageUrl,
        hasWebmsxyw: result?.hasWebmsxyw,
        signedKeys: result?.signedKeys
      }
    } catch (err) {
      logger.warn('[sign] xiaohongshu Electron browser POST failed:', err)
      return null
    } finally {
      if (fetchEnabled) {
        try { await dbg.sendCommand('Fetch.disable') } catch {
          // Debugger may already be detached if the hidden window navigated.
        }
      }
      dbg.removeListener('message', captureListener)
      if (attachedByUs && dbg.isAttached()) {
        try { dbg.detach() } catch {
          // Detach is best-effort during cleanup.
        }
      }
    }
  }

  private async getSelfHostedSignature(
    platform: string,
    cookie: string,
    data: string,
    body?: string,
    urlToSign?: string,
    accountId?: string
  ): Promise<string> {
    const signerUrl = getSelfHostedSignerUrl()
    if (!signerUrl) return ''

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), SIGN_TIMEOUT)
      const signEndpoint = signerUrl.replace(/\/$/, '').endsWith('/sign')
        ? signerUrl
        : `${signerUrl.replace(/\/$/, '')}/sign`
      const response = await fetch(signEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          cookie,
          data,
          body: body || '',
          url: urlToSign || '',
          accountId: accountId || '',
          signType: 'browser'
        }),
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!response.ok) {
        logger.warn(`[sign] Self-hosted signer returned HTTP ${response.status} for ${platform}`)
        return ''
      }

      const result = (await response.json()) as { signature?: string; data?: { signature?: string }; error?: string }
      const signature = result.signature || result.data?.signature || ''
      if (signature && signature !== 'null') return signature
      if (result.error) logger.warn(`[sign] Self-hosted signer error for ${platform}: ${result.error}`)
    } catch (err) {
      logger.warn(`[sign] Self-hosted signer unavailable for ${platform}:`, err)
    }

    return ''
  }

  /**
   * Douyin a_bogus signature generation.
   *
   * Uses Playwright's page.route() to intercept outgoing requests.
   * When we trigger an API call from the browser context, Douyin's anti-bot JS
   * adds the a_bogus parameter to the URL. We intercept the request, extract
   * the signature, and abort the request before it's actually sent.
   */
  private async getDouyinSignature(cookie: string, data: string, body?: string): Promise<string> {
    const page = await this.getOrCreatePage('douyin', cookie, DOUYIN_SIGN_CONTEXT_URL)

    try {
      let capturedSignature = ''
      const urlToSign = data.includes('a_bogus=')
        ? data
        : `${data}${data.includes('?') ? '&' : '?'}a_bogus=`
      let targetPath = ''
      try {
        targetPath = new URL(data).pathname
      } catch {
        // Keep empty targetPath and accept the first captured signature.
      }

      // Set up route interceptor to capture a_bogus from outgoing requests
      // Match both aweme/v1 and web/api paths — anti-bot may rewrite to either
      const routeHandler = async (route: { request(): { url(): string }; abort(): Promise<void> }) => {
        const url = route.request().url()
        const match = url.match(/a_bogus=([^&]+)/)
        let isTargetRequest = !targetPath
        try {
          isTargetRequest = isTargetRequest || new URL(url).pathname === targetPath
        } catch {
          isTargetRequest = true
        }
        if (isTargetRequest && match && match[1]) {
          capturedSignature = match[1]
        }
        await route.abort()
      }

      const routePatterns = ['**/*a_bogus*', '**/aweme/v1/**', '**/web/api/media/aweme/**']

      try {
        for (const pattern of routePatterns) {
          await page.route(pattern, routeHandler)
        }

        // Wait longer for anti-bot JS to fully initialize (it may load lazily)
        await page.waitForTimeout(3000)

        // Try both XHR and fetch against the actual URL being signed. Douyin's
        // a_bogus is request-specific, so signing a generic endpoint produces a
        // value that can fail on create_v2.
        await page.evaluate(
          ({ urlToSign, body }) => {
            const method = body ? 'POST' : 'GET'

            try {
              const xhr = new XMLHttpRequest()
              xhr.open(method, urlToSign, true)
              xhr.withCredentials = true
              if (body) {
                xhr.setRequestHeader('Content-Type', 'application/json')
              }
              xhr.send(body || null)
            } catch {
              // The fetch path below gives the signer a second chance.
            }

            try {
              fetch(urlToSign, {
                method,
                credentials: 'include',
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body || undefined
              }).catch(() => {})
            } catch {
              // Route capture will report failure if neither request reaches the network layer.
            }
          },
          { urlToSign, body: body || '' }
        )

        // Wait for the route interceptor to fire
        await page.waitForTimeout(3000)
      } finally {
        for (const pattern of routePatterns) {
          try { await page.unroute(pattern, routeHandler) } catch {
            // The page may have been reset after a signing failure.
          }
        }
      }

      if (capturedSignature) {
        logger.info('[sign] Douyin a_bogus captured successfully')
        return capturedSignature
      }

      logger.warn('[sign] Douyin a_bogus not captured by built-in local signer')

      if (isLegacyExternalSignerEnabled() && data) {
        logger.warn('[sign] Trying explicitly enabled legacy external signer for douyin')
        const urlToSign = data
        return await this.getExternalSignature('douyin', cookie, data, body, urlToSign)
      }

      return ''
    } catch (err) {
      logger.error('[sign] Douyin signature generation failed:', err)
      this.resetPage('douyin')
      return ''
    }
  }

  private async triggerDouyinBrowserPost(
    page: Page,
    url: string,
    body: string,
    headers: Record<string, string>,
    transport: 'xhr' | 'fetch'
  ): Promise<void> {
    await page.evaluate(
      ({ url, body, headers, transport }) => {
        const setHeaders = (setHeader: (name: string, value: string) => void) => {
          for (const [name, value] of Object.entries(headers)) {
            try {
              setHeader(name, value)
            } catch {
              // Browsers reject forbidden headers; the platform hook still sees
              // the normal browser-generated values.
            }
          }
        }

        if (transport === 'xhr') {
          try {
            const xhr = new XMLHttpRequest()
            xhr.open('POST', url, true)
            xhr.withCredentials = true
            setHeaders((name, value) => xhr.setRequestHeader(name, value))
            xhr.send(body)
          } catch {
            // The route capture will report failure if the request never starts.
          }
          return
        }

        try {
          fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body
          }).catch(() => {})
        } catch {
          // The route capture will report failure if the request never starts.
        }
      },
      { url, body, headers, transport }
    )
  }

  /**
   * Try to get signature from yixiaoer's external signature server (fallback).
   * Returns empty string if unavailable.
   *
   * For kuaishou: the `cookie` param must be MD5(requestBody), matching yixiaoer's getSign$5.
   * @param urlToSign The full URL to sign (used by douyin external service)
   */
  private async getExternalSignature(
    platform: string,
    cookie: string,
    data: string,
    body?: string,
    urlToSign?: string
  ): Promise<string> {
    const externalPlatform = platform === 'xiaohongshu' ? 'newxiaohongshu' : platform
    const endpoints = this.getLegacySignerEndpoints(platform, externalPlatform)
    if (endpoints.length === 0) return ''

    // Kuaishou's signing service expects MD5(body) as the cookie parameter (yixiaoer's approach)
    let signCookie = cookie
    if (platform === 'kuaishou' && body) {
      signCookie = createHash('md5').update(body).digest('hex')
    } else if (platform === 'xiaohongshu') {
      try {
        const parsed = JSON.parse(data) as { url?: string; body?: string }
        const urlPath = parsed.url || '/web_api/sns/v2/note'
        const bodyStr = parsed.body || body || ''
        signCookie = JSON.stringify(bodyStr ? [urlPath, encodeURIComponent(bodyStr)] : [urlPath])
      } catch {
        signCookie = JSON.stringify(['/web_api/sns/v2/note'])
      }
    }

    for (const url of endpoints) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=utf-8',
            'User-Agent': 'axios/1.0.0'
          },
          body: JSON.stringify({
            url: urlToSign || '',
            cookie: signCookie,
            signType: 'browser',
            signCommand: externalPlatform
          }),
          signal: controller.signal
        })
        clearTimeout(timeout)

        const result = (await response.json()) as { signature?: string; err?: string }
        if (result.signature && result.signature !== 'null') {
          logger.info(`[sign] External signature obtained for ${platform} via ${this.maskLegacySignerEndpoint(url)}`)
          return result.signature
        }
        if (result.err) {
          logger.warn(`[sign] External signer error for ${platform} via ${this.maskLegacySignerEndpoint(url)}: ${result.err}`)
        }
      } catch (err) {
        logger.warn(
          `[sign] External signer unavailable for ${platform} via ${this.maskLegacySignerEndpoint(url)}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        )
        // Try next port
      }
    }
    return ''
  }

  private isKuaishouYixiaoerSignerAllowed(platform: string): boolean {
    if (platform !== 'kuaishou') return false
    const raw = process.env.FLOW_PUBLISHER_KUAISHOU_YIXIAOER_SIGNER?.trim().toLowerCase()
    return !['0', 'false', 'off', 'disabled'].includes(raw || '')
  }

  private isXhsYixiaoerSignerAllowed(platform: string): boolean {
    if (platform !== 'xiaohongshu') return false
    const raw = process.env.FLOW_PUBLISHER_XHS_YIXIAOER_SIGNER?.trim().toLowerCase()
    return !['0', 'false', 'off', 'disabled'].includes(raw || '')
  }

  private getLegacySignerEndpoints(platform: string, externalPlatform: string): string[] {
    const keys = this.getLegacySignerEnvKeys(platform)
    const specificUrl = this.firstEnv(keys.map((key) => `FLOW_PUBLISHER_${key}_LEGACY_SIGNER_URL`))
    const sharedUrl = process.env.FLOW_PUBLISHER_LEGACY_SIGNER_URL?.trim()
    if (specificUrl || sharedUrl) {
      return [this.normalizeLegacySignerEndpoint(specificUrl || sharedUrl || '')]
    }

    const baseUrl =
      this.firstEnv(keys.map((key) => `FLOW_PUBLISHER_${key}_LEGACY_SIGNER_BASE_URL`)) ||
      process.env.FLOW_PUBLISHER_LEGACY_SIGNER_BASE_URL?.trim() ||
      process.env.FLOW_PUBLISHER_YIXIAOER_SIGNER_BASE_URL?.trim() ||
      YIXIAOER_SIGN_BASE
    const portsRaw =
      this.firstEnv(keys.map((key) => `FLOW_PUBLISHER_${key}_LEGACY_SIGNER_PORTS`)) ||
      process.env.FLOW_PUBLISHER_LEGACY_SIGNER_PORTS?.trim()
    const ports = portsRaw
      ? portsRaw.split(',').map((port) => port.trim()).filter(Boolean)
      : YIXIAOER_SIGN_PORTS[externalPlatform] || []

    return ports.map((port) => `${baseUrl.replace(/\/$/, '')}:${port}/Sign/GetSign`)
  }

  private getLegacySignerEnvKeys(platform: string): string[] {
    switch (platform) {
      case 'kuaishou':
        return ['KUAISHOU', 'KS']
      case 'xiaohongshu':
        return ['XIAOHONGSHU', 'XHS']
      default:
        return [platform.toUpperCase().replace(/[^A-Z0-9]/g, '_')]
    }
  }

  private firstEnv(names: string[]): string {
    for (const name of names) {
      const value = process.env[name]?.trim()
      if (value) return value
    }
    return ''
  }

  private normalizeLegacySignerEndpoint(url: string): string {
    const trimmed = url.trim().replace(/\/$/, '')
    if (!trimmed) return ''
    if (trimmed.endsWith('/Sign/GetSign')) return trimmed
    return `${trimmed}/Sign/GetSign`
  }

  private maskLegacySignerEndpoint(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
      return url
    }
  }

  private async getXhsSignatureInElectron(cookie: string, data: string, accountId?: string): Promise<string> {
    const queueKey = accountId || this.getCookieFingerprint(cookie)
    return await this.withXhsSignatureLock(queueKey, async () => {
      const win = await this.getOrCreateElectronWindow(
        'xiaohongshu',
        cookie,
        XHS_SIGN_CONTEXT_URL,
        accountId
      )

      try {
        const requestData = JSON.parse(data) as { url?: string; body?: string }
        const urlPath = requestData.url || '/web_api/sns/v2/note'
        const bodyStr = requestData.body || ''
        const requestUrl = urlPath.startsWith('http')
          ? urlPath
          : `https://edith.xiaohongshu.com${urlPath}`
        const candidates = [
          win.webContents.getURL(),
          ...XHS_SIGN_CONTEXT_FALLBACK_URLS
        ].filter((candidate, index, urls) => candidate && urls.indexOf(candidate) === index)

        for (const candidate of candidates) {
          if (win.webContents.getURL() !== candidate) {
            logger.info(`[sign] Trying alternate XHS signing context: ${candidate}`)
            await win.loadURL(candidate)
            await this.waitForElectronSignerReady(win, 'xiaohongshu')
          }

          const parsed = await this.generateXhsPageSignature(win, urlPath, bodyStr)
          const capturedXHeaders = await this.captureXhsFinalRequestHeaders(
            win,
            requestUrl,
            bodyStr,
            parsed
          )
          this.mergeXhsSignatureHeaders(parsed, capturedXHeaders)

          const xs = this.getHeaderValue(parsed, 'x-s')
          const xt = this.getHeaderValue(parsed, 'x-t')
          const xsCommon = this.getHeaderValue(parsed, 'x-s-common')
          const rapParam = this.getHeaderValue(parsed, 'x-rap-param')
          logger.info(
            `[sign] XHS signing context result: page=${candidate}, ` +
            `X-s=${xs ? 'yes' : 'no'}, X-t=${xt ? 'yes' : 'no'}, ` +
            `X-S-Common=${xsCommon ? 'yes' : 'no'}, x-rap-param=${rapParam ? 'yes' : 'no'}`
          )

          if (xs && xt && (!bodyStr || xsCommon || rapParam)) {
            return JSON.stringify(parsed)
          }
        }

        logger.warn('[sign] No XHS official signing context produced a usable current publish signature')
        return ''
      } catch (err) {
        logger.warn('[sign] XHS Electron signing failed:', err)
        this.resetElectronWindow('xiaohongshu', accountId)
        return ''
      }
    })
  }

  private async generateXhsPageSignature(
    win: BrowserWindow,
    urlPath: string,
    body: string
  ): Promise<Record<string, string>> {
    const signature = await win.webContents.executeJavaScript(`
      (function() {
        try {
          if (typeof window._webmsxyw !== 'function') return '';
          const urlPath = ${JSON.stringify(urlPath)};
          const bodyStr = ${JSON.stringify(body)};
          const bodyValue = (function() {
            if (!bodyStr) return undefined;
            try { return JSON.parse(bodyStr); } catch (err) { return bodyStr; }
          })();
          let signed = window._webmsxyw(urlPath, bodyValue);
          if (!signed) {
            const legacyPayload = bodyStr
              ? JSON.stringify([urlPath, encodeURIComponent(bodyStr)])
              : JSON.stringify([urlPath]);
            signed = window._webmsxyw(legacyPayload) || {};
          }
          if (typeof signed === 'string') {
            return JSON.stringify({ 'X-s': signed, 'X-t': String(Date.now()) });
          }
          return JSON.stringify(signed || {});
        } catch (err) {
          return '';
        }
      })()
    `, true) as string

    if (!signature) return {}
    const parsed = JSON.parse(signature) as Record<string, string>
    logger.info(`[sign] XHS Electron _webmsxyw returned keys: ${Object.keys(parsed).join(', ')}`)
    return parsed
  }

  private mergeXhsSignatureHeaders(
    target: Record<string, string>,
    captured: Record<string, string>
  ): void {
    for (const [name, value] of Object.entries(captured)) {
      const lowerName = name.toLowerCase()
      if (lowerName === 'x-s') target['X-s'] = value
      else if (lowerName === 'x-t') target['X-t'] = value
      else if (lowerName === 'x-s-common') target['X-S-Common'] = value
      else target[name] = value
    }
  }

  private async captureXhsFinalRequestHeaders(
    win: BrowserWindow,
    requestUrl: string,
    body: string,
    seedHeaders: Record<string, string>
  ): Promise<Record<string, string>> {
    const ses = win.webContents.session
    const target = new URL(requestUrl)
    const expectedMethod = body ? 'POST' : 'GET'
    const expectedBody = body ? Buffer.from(body) : null
    let bestCaptured: Record<string, string> = {}
    const capturedPromise = new Promise<Record<string, string>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(bestCaptured)
      }, 3_000)

      ses.webRequest.onBeforeSendHeaders(
        { urls: ['https://edith.xiaohongshu.com/*'] },
        (details, callback) => {
          const finish = (response: { cancel?: boolean; requestHeaders?: Record<string, string | string[]> }) => {
            callback(response)
          }

          try {
            if (
              details.webContentsId !== win.webContents.id ||
              details.method.toUpperCase() !== expectedMethod ||
              !this.isSameXhsRequestTarget(details.url, target) ||
              !this.isSameXhsRequestBody(details.uploadData, expectedBody)
            ) {
              finish({ requestHeaders: details.requestHeaders })
              return
            }

            const captured: Record<string, string> = {}
            for (const [name, value] of Object.entries(details.requestHeaders)) {
              const lowerName = name.toLowerCase()
              if (
                value &&
                (
                  lowerName.startsWith('x-') ||
                  lowerName === 'cookie'
                )
              ) {
                captured[name] = String(value)
              }
            }
            if (Object.keys(captured).length >= Object.keys(bestCaptured).length) {
              bestCaptured = captured
            }

            const xs = this.getHeaderValue(captured, 'x-s')
            const xt = this.getHeaderValue(captured, 'x-t')
            const xsCommon = this.getHeaderValue(captured, 'x-s-common')
            const rapParam = this.getHeaderValue(captured, 'x-rap-param')
            logger.info(
              `[sign] XHS onBeforeSendHeaders captured ${details.method} ${target.pathname}: ` +
              `keys=${Object.keys(captured).join(',') || 'none'}, ` +
              `X-S-Common=${xsCommon ? 'yes' : 'no'}, x-rap-param=${rapParam ? 'yes' : 'no'}`
            )

            // This is a signing probe only. Never let it reach note/create.
            finish({ cancel: true })

            if (xs && xt && (!expectedBody || xsCommon || rapParam)) {
              clearTimeout(timeout)
              resolve(captured)
            }
          } catch (err) {
            finish({ cancel: true })
            clearTimeout(timeout)
            reject(err)
          }
        }
      )
    })

    try {
      const xs = this.getHeaderValue(seedHeaders, 'x-s')
      const xt = this.getHeaderValue(seedHeaders, 'x-t')
      void win.webContents.executeJavaScript(`
        (function() {
          const requestUrl = ${JSON.stringify(requestUrl)};
          const body = ${JSON.stringify(body)};
          const xs = ${JSON.stringify(xs)};
          const xt = ${JSON.stringify(xt)};
          const method = body ? 'POST' : 'GET';

          const makeHeaders = function() {
            const headers = {};
            if (body) headers['Content-Type'] = 'application/json;charset=UTF-8';
            if (xs) headers['X-s'] = xs;
            if (xt) headers['X-t'] = xt;
            return headers;
          };

          try {
            const options = {
              method,
              credentials: 'include',
              headers: makeHeaders()
            };
            if (body) options.body = body;
            fetch(requestUrl, options).catch(function() {});
          } catch (err) {}

          setTimeout(function() {
            try {
              const xhr = new XMLHttpRequest();
              xhr.open(method, requestUrl, true);
              xhr.withCredentials = true;
              const headers = makeHeaders();
              for (const [name, value] of Object.entries(headers)) {
                xhr.setRequestHeader(name, String(value));
              }
              xhr.send(body || null);
            } catch (err) {}
          }, 800);
        })()
      `, true).catch((err) => {
        logger.warn('[sign] Failed to trigger XHS final-header capture request:', err)
      })

      return await capturedPromise
    } finally {
      ses.webRequest.onBeforeSendHeaders(null)
    }
  }

  private isSameXhsRequestTarget(actualUrl: string, expectedUrl: URL): boolean {
    try {
      const actual = new URL(actualUrl)
      return actual.origin === expectedUrl.origin &&
        actual.pathname === expectedUrl.pathname &&
        actual.search === expectedUrl.search
    } catch {
      return false
    }
  }

  private isSameXhsRequestBody(
    uploadData: Array<{ bytes?: Buffer }> | undefined,
    expectedBody: Buffer | null
  ): boolean {
    if (!expectedBody || !uploadData?.length) return true
    const chunks = uploadData
      .map((item) => item.bytes)
      .filter((bytes): bytes is Buffer => Buffer.isBuffer(bytes))
    if (chunks.length === 0) return true
    return Buffer.concat(chunks).equals(expectedBody)
  }

  private async withXhsSignatureLock<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.xhsSignatureQueues.get(key) || Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => {}).then(() => gate)
    this.xhsSignatureQueues.set(key, tail)

    await previous.catch(() => {})
    try {
      return await task()
    } finally {
      release()
      if (this.xhsSignatureQueues.get(key) === tail) {
        this.xhsSignatureQueues.delete(key)
      }
    }
  }

  private async getKuaishouSignatureInElectron(cookie: string, data: string, accountId?: string): Promise<string> {
    const win = await this.getOrCreateElectronWindow(
      'kuaishou',
      cookie,
      'https://cp.kuaishou.com/article/publish/video',
      accountId
    )

    let capturedSig3 = ''

    try {
      const { url: apiUrl, body } = JSON.parse(data) as { url: string; body?: string }
      const targetPath = apiUrl.startsWith('http') ? new URL(apiUrl).pathname : apiUrl
      const fullUrl = apiUrl.startsWith('http') ? apiUrl : `https://cp.kuaishou.com${apiUrl}`
      const triggerUrl = fullUrl.includes('__NS_sig3=')
        ? fullUrl
        : `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}__NS_sig3=`

      await this.captureElectronFetchRequest(
        win,
        [{ urlPattern: '*://cp.kuaishou.com/rest/*', requestStage: 'Request' }],
        async () => {
          await win.webContents.executeJavaScript(`
            (function() {
              try {
                const fullUrl = ${JSON.stringify(triggerUrl)};
                const body = ${JSON.stringify(body || '')};
                fetch(fullUrl, {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                  body
                }).catch(function() {});

                setTimeout(function() {
                  try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', fullUrl, true);
                    xhr.withCredentials = true;
                    xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
                    xhr.send(body || null);
                  } catch (err) {}
                }, 800);
              } catch (err) {}
            })()
          `, true)
        },
        (params) => {
          const requestUrl = String(params?.request?.url || '')
          const method = String(params?.request?.method || '').toUpperCase()
          if (method === 'OPTIONS') return false
          let isTarget = requestUrl.includes(targetPath)
          try {
            isTarget = new URL(requestUrl).pathname === targetPath
          } catch {
            // Keep substring fallback.
          }
          if (!isTarget) return false

          const match = requestUrl.match(/__NS_sig3=([^&]+)/)
          if (match?.[1]) {
            capturedSig3 = decodeURIComponent(match[1])
            logger.info('[sign] Kuaishou Electron __NS_sig3 captured')
            return true
          }
          logger.info(`[sign] Kuaishou Electron intercepted ${method || 'request'} without __NS_sig3`)
          return method === 'POST'
        }
      )

      if (capturedSig3) return capturedSig3
      logger.warn('[sign] Kuaishou Electron signer did not capture __NS_sig3')
      return ''
    } catch (err) {
      logger.warn('[sign] Kuaishou Electron signing failed:', err)
      this.resetElectronWindow('kuaishou', accountId)
      return ''
    }
  }

  /**
   * Xiaohongshu X-s / X-t signature generation.
   *
   * Tries:
   * 1. Local Playwright-based signing via _webmsxyw function on the XHS page
   * 2. New external signing service (ports 5061-5063, signCommand: "newxiaohongshu")
   * 3. Old external signing service (port 5096, signCommand: "xiaohongshu")
   */
  private async getXhsSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('xiaohongshu', cookie, XHS_SIGN_CONTEXT_URL)

    try {
      // Step 1: Get X-s and X-t from _webmsxyw
      const signature = await page.evaluate(
        ({ data }) => {
          return new Promise<string>((resolve) => {
            const win = window as unknown as Record<string, unknown>

            if (typeof win._webmsxyw === 'function') {
              try {
                const parsed = JSON.parse(data) as { url?: string; body?: string }
                const urlPath = parsed.url || '/web_api/sns/v2/note'
                const bodyStr = parsed.body || ''
                const bodyValue = (() => {
                  if (!bodyStr) return undefined
                  try { return JSON.parse(bodyStr) } catch { return bodyStr }
                })()
                const signer = win._webmsxyw as (path: string, data?: unknown) => unknown
                let result = signer(urlPath, bodyValue)
                if (!result) {
                  const legacyPayload = bodyStr
                    ? JSON.stringify([urlPath, encodeURIComponent(bodyStr)])
                    : JSON.stringify([urlPath])
                  result = (win._webmsxyw as (payload: string) => unknown)(legacyPayload)
                }
                if (typeof result === 'string') {
                  resolve(JSON.stringify({ 'X-s': result, 'X-t': String(Date.now()) }))
                } else {
                  resolve(JSON.stringify(result || {}))
                }
              } catch {
                resolve('')
              }
            } else {
              resolve('')
            }

            setTimeout(() => resolve(''), 3000)
          })
        },
        { data }
      )

      // Log what _webmsxyw returned for debugging
      if (signature) {
        try {
          const sigObj = JSON.parse(signature)
          logger.info(`[sign] XHS _webmsxyw returned keys: ${Object.keys(sigObj).join(', ')}`)
        } catch { /* ignore */ }
      }

      // Step 2: Capture X-S-Common via route interceptor
      // X-S-Common is added by anti-bot JS's XHR/fetch interceptor when making same-origin requests.
      // We trigger a same-origin fetch (creator.xiaohongshu.com) so the anti-bot JS intercepts it.
      let capturedXSCommon = ''
      const capturedXHeaders: Record<string, string> = {}
      const routePattern = '**/edith.xiaohongshu.com/**'
      const routeHandler = async (route: any) => {
        const headers = route.request().headers()
        const xsCommon = headers['x-s-common']
        if (xsCommon) {
          capturedXSCommon = xsCommon
          logger.info('[sign] XHS X-S-Common captured')
        }
        // Also log all custom headers for debugging
        const customHeaders = Object.keys(headers).filter(h => h.startsWith('x-'))
        if (customHeaders.length > 0) {
          logger.info(`[sign] XHS intercepted request x-headers: ${customHeaders.join(', ')}`)
          for (const name of customHeaders) {
            const value = headers[name]
            if (value) capturedXHeaders[name] = value
          }
        }
        await route.abort()
      }

      try {
        await page.route(routePattern, routeHandler)

        // Parse the URL path and body from data
        const parsed = JSON.parse(data) as { url?: string; body?: string }
        const urlPath = parsed.url || '/web_api/sns/v2/note'
        const bodyStr = parsed.body || ''

        // Try triggering an XHR to the same edith endpoint — XHR may be hooked differently than fetch
        await page.evaluate(
          ({ urlPath, bodyStr }) => {
            // Use XHR instead of fetch — anti-bot may hook XHR differently
            try {
              const xhr = new XMLHttpRequest()
              xhr.open('POST', `https://edith.xiaohongshu.com${urlPath}`, true)
              xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8')
              xhr.withCredentials = true
              xhr.send(bodyStr || null)
            } catch {
              // Fetch fallback below handles contexts where XHR is blocked.
            }
          },
          { urlPath, bodyStr }
        )

        // Wait for the route interceptor to fire
        await page.waitForTimeout(3000)

        // If XHR didn't work, try fetch as fallback
        if (!capturedXSCommon) {
          await page.evaluate(
            ({ urlPath, bodyStr }) => {
              const fullUrl = `https://edith.xiaohongshu.com${urlPath}`
              const opts: RequestInit = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                credentials: 'include'
              }
              if (bodyStr) opts.body = bodyStr
              fetch(fullUrl, opts).catch(() => {})
            },
            { urlPath, bodyStr }
          )
          await page.waitForTimeout(3000)
        }
      } catch (interceptErr) {
        logger.warn('[sign] XHS X-S-Common interception failed:', interceptErr)
      } finally {
        try { await page.unroute(routePattern, routeHandler) } catch {
          // The page may have been reset after a signing failure.
        }
      }

      // Step 3: Combine X-s, X-t, and X-S-Common
      if (signature) {
        const parsed = JSON.parse(signature) as Record<string, string>
        if (capturedXSCommon) {
          parsed['X-S-Common'] = capturedXSCommon
        }
        for (const [name, value] of Object.entries(capturedXHeaders)) {
          const lowerName = name.toLowerCase()
          if (lowerName === 'x-s') parsed['X-s'] = value
          else if (lowerName === 'x-t') parsed['X-t'] = value
          else if (lowerName === 'x-s-common') parsed['X-S-Common'] = value
          else parsed[name] = value
        }
        return JSON.stringify(parsed)
      }

      // If _webmsxyw failed but we got X-S-Common, still return it
      if (capturedXSCommon) {
        logger.info('[sign] XHS: _webmsxyw failed but X-S-Common captured')
      }
    } catch (err) {
      logger.warn('[sign] XHS Playwright signing failed:', err)
      this.resetPage('xiaohongshu')
    }

    if (isLegacyExternalSignerEnabled()) {
      // Try new external signing service (yixiaoer's "newxiaohongshu" format)
      try {
        const parsed = JSON.parse(data) as { url?: string; body?: string }
        const urlPath = parsed.url || '/web_api/sns/v2/note'
        const bodyStr = parsed.body || ''

        const newSignPorts = YIXIAOER_SIGN_PORTS['newxiaohongshu']
        for (const port of newSignPorts) {
          try {
            const url = `${YIXIAOER_SIGN_BASE}:${port}/Sign/GetSign`
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 8000)

            const cookieValue = bodyStr
              ? JSON.stringify([urlPath, encodeURIComponent(bodyStr)])
              : JSON.stringify([urlPath])

            const response = await fetch(url, {
              method: 'POST',
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json;charset=utf-8',
                'User-Agent': 'axios/1.0.0'
              },
              body: JSON.stringify({
                url: '',
                cookie: cookieValue,
                signType: 'browser',
                signCommand: 'newxiaohongshu'
              }),
              signal: controller.signal
            })
            clearTimeout(timeout)

            const result = (await response.json()) as { signature?: string }
            if (result.signature && result.signature !== 'null') {
              logger.info(`[sign] XHS new external signature obtained via port ${port}`)
              return result.signature
            }
          } catch {
            // Try next port
          }
        }
      } catch {
        // Ignore parse errors
      }
    }

    return ''
  }

  /**
   * Kuaishou __NS_sig3 signature generation.
   *
   * Uses the same pattern as Douyin: load the creator page in a headless browser,
   * trigger an API call from the browser context, intercept the outgoing request
   * to capture the __NS_sig3 parameter that Kuaishou's anti-bot JS adds.
   *
   * @param data JSON string with { url, body } — url is the API path (e.g. "/rest/cp/works/v2/video/pc/upload/finish")
   */
  private async getKuaishouSignature(cookie: string, data: string): Promise<string> {
    const page = await this.getOrCreatePage('kuaishou', cookie, 'https://cp.kuaishou.com/article/publish/video')

    const routePattern = '**/cp.kuaishou.com/rest/**'
    let capturedSig3 = ''
    let routeHandler: ((route: any) => Promise<void>) | null = null

    try {
      const { url: apiUrl, body } = JSON.parse(data) as { url: string; body?: string }

      // Set up route interceptor to capture __NS_sig3 from outgoing requests
      routeHandler = async (route: any) => {
        const reqUrl = route.request().url()
        const match = reqUrl.match(/__NS_sig3=([^&]+)/)
        if (match && match[1]) {
          capturedSig3 = match[1]
          logger.info('[sign] Kuaishou __NS_sig3 captured')
        }
        // Abort — we only needed the signature
        await route.abort()
      }
      await page.route(routePattern, routeHandler)

      // Trigger an API call from the browser context.
      // Kuaishou's anti-bot JS intercepts fetch/XHR and adds __NS_sig3 before sending.
      await page.evaluate(
        ({ apiUrl, body }) => {
          const fullUrl = `https://cp.kuaishou.com${apiUrl}`
          const fetchOptions: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            credentials: 'include'
          }
          if (body) {
            fetchOptions.body = body
          }
          fetch(fullUrl, fetchOptions).catch(() => {})
        },
        { apiUrl, body: body || '' }
      )

      // Wait for the route interceptor to fire
      await page.waitForTimeout(3000)

      if (capturedSig3) {
        logger.info(`[sign] Kuaishou __NS_sig3 captured successfully`)
        return capturedSig3
      }

      logger.warn('[sign] Kuaishou __NS_sig3 not captured — anti-bot JS may not have intercepted the request')
      return ''
    } catch (err) {
      logger.error('[sign] Kuaishou signature generation failed:', err)
      this.resetPage('kuaishou')
      return ''
    } finally {
      // Always clean up the route to prevent leaks on retry
      try {
        if (routeHandler) {
          await page.unroute(routePattern, routeHandler)
        } else {
          await page.unroute(routePattern)
        }
      } catch {
        // Ignore cleanup errors — page may already be closed
      }
    }
  }

  /**
   * Get or create a browser context and page for a platform.
   */
  private async getOrCreatePage(platform: string, cookie: string, url: string): Promise<Page> {
    // Wait if already initializing
    const initPromise = this.initializing.get(platform)
    if (initPromise) {
      await initPromise
    }

    const existingPage = this.pages.get(platform)
    if (existingPage && !existingPage.isClosed()) {
      // Update cookies
      const context = existingPage.context()
      await context.clearCookies()
      const cookieDomainMap: Record<string, string> = {
        douyin: '.douyin.com',
        xiaohongshu: '.xiaohongshu.com',
        kuaishou: '.kuaishou.com'
      }
      const domain = cookieDomainMap[platform] || '.douyin.com'
      const cookieArray = cookie.split('; ').map((c) => {
        const [name, ...valueParts] = c.split('=')
        return {
          name: name.trim(),
          value: valueParts.join('='),
          domain,
          path: '/'
        }
      })
      await context.addCookies(cookieArray)
      const fingerprint = this.getCookieFingerprint(cookie)
      const previousFingerprint = this.cookieFingerprints.get(platform)
      if (previousFingerprint !== fingerprint || this.shouldReloadExistingPage(existingPage, url, platform)) {
        logger.info(`[sign] Reloading ${platform} signature page after cookie/page change`)
        await existingPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await existingPage.waitForTimeout(5000)
      }
      this.cookieFingerprints.set(platform, fingerprint)
      return existingPage
    }

    // Create new context and page
    const initResolve: (() => void)[] = []
    const initPromiseNew = new Promise<void>((resolve) => {
      initResolve.push(resolve)
    })
    this.initializing.set(platform, initPromiseNew)

    try {
      const profileDir = join(this.getSignDataDir(), platform)
      if (!existsSync(profileDir)) {
        mkdirSync(profileDir, { recursive: true })
      }

      const executablePath = this.findBrowser()
      if (!executablePath) {
        throw new Error('未找到 Chrome 或 Edge 浏览器')
      }

      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        executablePath,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ],
        viewport: { width: 1920, height: 1080 },
        locale: 'zh-CN',
        bypassCSP: true
      })

      // Set cookies with correct domain for each platform
      await context.clearCookies()
      const cookieDomainMap: Record<string, string> = {
        douyin: '.douyin.com',
        xiaohongshu: '.xiaohongshu.com',
        kuaishou: '.kuaishou.com'
      }
      const domain = cookieDomainMap[platform] || '.douyin.com'
      const cookieArray = cookie.split('; ').map((c) => {
        const [name, ...valueParts] = c.split('=')
        return {
          name: name.trim(),
          value: valueParts.join('='),
          domain,
          path: '/'
        }
      })
      await context.addCookies(cookieArray)

      const page = await context.newPage()

      // Minimal page init for the local signer context.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true
        })
        const navigatorPrototype = Object.getPrototypeOf(navigator) as Record<string, unknown> | null
        if (navigatorPrototype) delete navigatorPrototype.webdriver
      })

      logger.info(`[sign] Loading ${platform} creator page: ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

      // Wait for page JS to initialize
      await page.waitForTimeout(5000)

      this.contexts.set(platform, context)
      this.pages.set(platform, page)
      this.cookieFingerprints.set(platform, this.getCookieFingerprint(cookie))

      logger.info(`[sign] ${platform} signature context ready`)
      return page
    } finally {
      initResolve[0]?.()
      this.initializing.delete(platform)
    }
  }

  private resetPage(platform: string): void {
    const page = this.pages.get(platform)
    if (page && !page.isClosed()) {
      page.close().catch(() => {})
    }
    this.pages.delete(platform)
    this.cookieFingerprints.delete(platform)
  }

  private async getOrCreateElectronWindow(
    platform: string,
    cookie: string,
    url: string,
    accountId?: string
  ): Promise<BrowserWindow> {
    const key = this.getElectronWindowKey(platform, accountId)
    const existing = this.electronWindows.get(key)
    const fingerprint = this.getCookieFingerprint(cookie)

    if (existing && !existing.isDestroyed()) {
      await this.syncCookiesToElectronSession(existing.webContents.session, platform, cookie)
      const previousFingerprint = this.electronCookieFingerprints.get(key)
      if (previousFingerprint !== fingerprint || this.shouldReloadElectronWindow(existing, url, platform)) {
        logger.info(`[sign] Reloading ${platform} Electron signer page after cookie/page change`)
        await this.loadElectronSignerPage(existing, platform, url)
      } else if (platform === 'xiaohongshu') {
        const ready = await this.waitForElectronSignerReady(existing, platform)
        if (!ready) {
          logger.info('[sign] Reloading xiaohongshu Electron signer page because _webmsxyw is not ready')
          await this.loadElectronSignerPage(existing, platform, url)
        }
      }
      this.electronCookieFingerprints.set(key, fingerprint)
      return existing
    }

    const partition = accountId ? `persist:auth-${accountId}` : `persist:sign-${platform}`
    const ses = session.fromPartition(partition)
    await this.syncCookiesToElectronSession(ses, platform, cookie)

    const win = new BrowserWindow({
      show: false,
      width: 1366,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition
      }
    })
    hardenPlatformWindow(win, platform)

    win.webContents.setUserAgent(REALISTIC_UA)
    win.on('closed', () => {
      this.electronWindows.delete(key)
      this.electronCookieFingerprints.delete(key)
    })

    logger.info(`[sign] Loading ${platform} Electron signer page (${accountId ? 'auth session' : 'sign session'}): ${url}`)
    await this.loadElectronSignerPage(win, platform, url)

    this.electronWindows.set(key, win)
    this.electronCookieFingerprints.set(key, fingerprint)
    return win
  }

  private async loadElectronSignerPage(win: BrowserWindow, platform: string, url: string): Promise<void> {
    if (platform !== 'xiaohongshu') {
      await win.loadURL(url)
      await this.waitForElectronSignerReady(win, platform)
      return
    }

    const candidates = [
      url,
      ...XHS_SIGN_CONTEXT_FALLBACK_URLS
    ].filter((candidate, index, urls) => urls.indexOf(candidate) === index)

    for (const candidate of candidates) {
      logger.info(`[sign] Loading xiaohongshu Electron signer candidate: ${candidate}`)
      try {
        await win.loadURL(candidate)
        const ready = await this.waitForElectronSignerReady(win, platform)
        if (ready) return
        const diagnostics = await win.webContents.executeJavaScript(`
          (function() {
            return {
              href: String(location.href || ''),
              title: String(document.title || ''),
              cookieNames: String(document.cookie || '').split(';').map(function(part) {
                return part.trim().split('=')[0];
              }).filter(Boolean).slice(0, 20)
            };
          })()
        `, true).catch((err) => ({ error: String(err && err.message ? err.message : err) }))
        logger.info(
          `[sign] xiaohongshu signer candidate diagnostics: ${JSON.stringify(
            summarizePayload(diagnostics)
          )}`
        )
      } catch (err) {
        logger.warn(`[sign] Failed to load xiaohongshu signer candidate ${candidate}:`, err)
      }
    }

    logger.warn('[sign] No xiaohongshu Electron signer candidate initialized _webmsxyw')
  }

  private async waitForElectronSignerReady(win: BrowserWindow, platform: string): Promise<boolean> {
    if (platform !== 'xiaohongshu') {
      await this.wait(5000)
      return true
    }

    try {
      const ready = await win.webContents.executeJavaScript(`
        (async function() {
          const startedAt = Date.now();
          while (Date.now() - startedAt < 15000) {
            if (typeof window._webmsxyw === 'function') return true;
            await new Promise(function(resolve) { setTimeout(resolve, 500); });
          }
          return false;
        })()
      `, true) as boolean
      logger.info(`[sign] xiaohongshu Electron signer ready: _webmsxyw=${ready ? 'yes' : 'no'}`)
      return ready
    } catch (err) {
      logger.warn('[sign] Failed while waiting for xiaohongshu Electron signer readiness:', err)
      await this.wait(5000)
      return false
    }
  }

  private resetElectronWindow(platform: string, accountId?: string): void {
    const keys = accountId
      ? [this.getElectronWindowKey(platform, accountId)]
      : Array.from(this.electronWindows.keys()).filter((key) => key.startsWith(`${platform}:`))

    for (const key of keys) {
      const win = this.electronWindows.get(key)
      if (win && !win.isDestroyed()) {
        win.close()
      }
      this.electronWindows.delete(key)
      this.electronCookieFingerprints.delete(key)
    }
  }

  private async captureElectronFetchRequest(
    win: BrowserWindow,
    patterns: Array<{ urlPattern: string; requestStage: 'Request' | 'Response' }>,
    trigger: () => Promise<void>,
    handlePausedRequest: (params: any) => boolean
  ): Promise<void> {
    const dbg = win.webContents.debugger
    const attachedByUs = !dbg.isAttached()
    const networkRequests = new Map<string, { url: string; method: string }>()

    if (attachedByUs) {
      dbg.attach('1.3')
    }

    const listener = async (_event: unknown, method: string, params: any) => {
      if (method === 'Network.requestWillBeSent') {
        const requestId = String(params?.requestId || '')
        const request = params?.request || {}
        if (requestId) {
          networkRequests.set(requestId, {
            url: String(request.url || ''),
            method: String(request.method || '')
          })
        }
        return
      }

      if (method === 'Network.requestWillBeSentExtraInfo') {
        const requestId = String(params?.requestId || '')
        const request = networkRequests.get(requestId)
        if (request) {
          handlePausedRequest({
            request: {
              url: request.url,
              method: request.method,
              headers: params?.headers || {}
            }
          })
        }
        return
      }

      if (method !== 'Fetch.requestPaused') return

      const handled = handlePausedRequest(params)
      try {
        if (handled) {
          await dbg.sendCommand('Fetch.failRequest', {
            requestId: params.requestId,
            errorReason: 'Aborted'
          })
        } else {
          await dbg.sendCommand('Fetch.continueRequest', {
            requestId: params.requestId
          })
        }
      } catch {
        // The request may already be gone if the page navigated.
      }
    }

    dbg.on('message', listener)
    try {
      await dbg.sendCommand('Network.enable')
      await dbg.sendCommand('Fetch.enable', { patterns })
      await trigger()
      await this.wait(5000)
    } finally {
      try { await dbg.sendCommand('Fetch.disable') } catch {
        // The debugger may already be detached if the window navigated/closed.
      }
      try { await dbg.sendCommand('Network.disable') } catch {
        // Network may already be disabled if the debugger detached.
      }
      dbg.removeListener('message', listener)
      if (attachedByUs && dbg.isAttached()) {
        try { dbg.detach() } catch {
          // Detach is best-effort during cleanup.
        }
      }
    }
  }

  private getCookieFingerprint(cookie: string): string {
    return createHash('sha256').update(cookie).digest('hex')
  }

  private getElectronWindowKey(platform: string, accountId?: string): string {
    return `${platform}:${accountId || 'sign'}`
  }

  private async syncCookiesToElectronSession(
    ses: Session,
    platform: string,
    cookie: string
  ): Promise<void> {
    const config: Record<string, { url: string; domain: string }> = {
      douyin: { url: 'https://creator.douyin.com', domain: '.douyin.com' },
      xiaohongshu: { url: 'https://creator.xiaohongshu.com', domain: '.xiaohongshu.com' },
      kuaishou: { url: 'https://cp.kuaishou.com', domain: '.kuaishou.com' }
    }
    const target = config[platform] || config.douyin
    const hostOnlyUrls = platform === 'xiaohongshu'
      ? ['https://creator.xiaohongshu.com', 'https://www.xiaohongshu.com']
      : [target.url]

    for (const part of cookie.split(';')) {
      const trimmed = part.trim()
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex <= 0) continue

      const name = trimmed.slice(0, separatorIndex)
      const value = trimmed.slice(separatorIndex + 1)
      if (!name || !value) continue

      try {
        if (name.startsWith('__Host-')) {
          for (const url of hostOnlyUrls) {
            await ses.cookies.set({
              url,
              name,
              value,
              path: '/',
              secure: true
            })
          }
        } else {
          await ses.cookies.set({
            url: target.url,
            name,
            value,
            domain: target.domain,
            path: '/',
            secure: true
          })
        }
      } catch {
        // Keep the existing persisted Electron session cookie if setting this
        // cookie shape is rejected.
      }
    }
  }

  private hasNonEmptyABogus(url: string): boolean {
    try {
      const value = new URL(url).searchParams.get('a_bogus')
      return Boolean(value && value.trim())
    } catch {
      const match = url.match(/[?&]a_bogus=([^&]+)/)
      return Boolean(match?.[1])
    }
  }

  private getHeaderValue(headers: Record<string, unknown>, name: string): string {
    const lowerName = name.toLowerCase()
    for (const [key, value] of Object.entries(headers || {})) {
      if (key.toLowerCase() === lowerName && value) return String(value)
    }
    return ''
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private shouldReloadElectronWindow(win: BrowserWindow, desiredUrl: string, platform: string): boolean {
    try {
      const current = new URL(win.webContents.getURL())
      const desired = new URL(desiredUrl)
      if (current.origin !== desired.origin) return true

      if (platform === 'xiaohongshu') {
        return current.pathname !== desired.pathname
      }
      if (platform === 'kuaishou') {
        return !current.pathname.includes('/article/publish/video')
      }
      return current.pathname !== desired.pathname
    } catch {
      return true
    }
  }

  private shouldReloadExistingPage(page: Page, desiredUrl: string, platform: string): boolean {
    try {
      const current = new URL(page.url())
      const desired = new URL(desiredUrl)
      if (platform === 'xiaohongshu') {
        return current.origin !== desired.origin || current.pathname !== desired.pathname
      }
      if (platform !== 'douyin') return false
      return current.origin !== desired.origin || current.pathname !== desired.pathname
    } catch {
      return true
    }
  }

  private findBrowser(): string | null {
    // Cross-platform browser discovery — ordered by likelihood
    const platformCandidates: Record<string, string[]> = {
      win32: [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/snap/bin/chromium',
      ],
    }

    // Try Windows registry first (most accurate on Windows)
    if (process.platform === 'win32') {
      try {
        const result = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
          { encoding: 'utf-8', timeout: 1000 }
        )
        const match = result.match(/ProgId\s+REG_SZ\s+(.+)/)
        if (match) {
          const progId = match[1].trim()
          if (progId.includes('Edge')) {
            const p = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
            if (existsSync(p)) return p
          }
          if (progId.includes('Chrome')) {
            const p = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            if (existsSync(p)) return p
          }
        }
      } catch { /* registry query can fail; fall through to candidates */ }
    }

    const candidates = platformCandidates[process.platform] || platformCandidates.win32
    for (const p of candidates) {
      if (existsSync(p)) return p
    }
    return null
  }

  private getSignDataDir(): string {
    const dir = join(app.getPath('userData'), 'sign-profiles')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /**
   * Get a specific cookie value from the loaded page for a platform.
   * Useful for extracting cookies set by the platform's JS (e.g., msToken for Douyin).
   */
  async getCookieFromPage(platform: string, cookieName: string): Promise<string> {
    const page = this.pages.get(platform)
    if (!page || page.isClosed()) return ''

    try {
      const cookies = await page.context().cookies()
      const match = cookies.find((c) => c.name === cookieName)
      return match?.value || ''
    } catch {
      return ''
    }
  }

  async getCookieStringFromPage(platform: string): Promise<string> {
    const page = this.pages.get(platform)
    if (!page || page.isClosed()) return ''

    try {
      const cookies = await page.context().cookies()
      return cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    } catch {
      return ''
    }
  }

  /**
   * Clean up all browser contexts.
   */
  async dispose(): Promise<void> {
    for (const [platform, page] of this.pages) {
      try {
        if (!page.isClosed()) await page.close()
      } catch (err) {
        logger.error(`[sign] Error closing ${platform} page:`, err)
      }
    }
    for (const [platform, context] of this.contexts) {
      try {
        await context.close()
      } catch (err) {
        logger.error(`[sign] Error closing ${platform} context:`, err)
      }
    }
    this.pages.clear()
    this.contexts.clear()
  }
}

// Singleton instance
let signServiceInstance: SignService | null = null

export function getSignService(): SignService {
  if (!signServiceInstance) {
    signServiceInstance = new SignService()
  }
  return signServiceInstance
}
