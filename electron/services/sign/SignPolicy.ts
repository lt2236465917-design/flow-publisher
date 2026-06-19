export type SignMode = 'self-hosted' | 'legacy-external'

export const DEFAULT_SELF_HOSTED_SIGNER_URL = 'http://127.0.0.1:17321'

export const PLATFORM_NAMES: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手'
}

const WEB_SIGNATURE_PLATFORMS = new Set(['douyin', 'xiaohongshu', 'kuaishou'])

function isKuaishouOfficialOpenApiConfigured(): boolean {
  return Boolean(
    process.env.FLOW_PUBLISHER_KUAISHOU_OPENAPI_APP_ID?.trim() &&
    process.env.FLOW_PUBLISHER_KUAISHOU_OPENAPI_ACCESS_TOKEN?.trim()
  )
}

export function getPlatformName(platform: string): string {
  return PLATFORM_NAMES[platform] || platform
}

export function requiresWebSignature(platform: string): boolean {
  if (platform === 'kuaishou' && isKuaishouOfficialOpenApiConfigured()) {
    return false
  }
  return WEB_SIGNATURE_PLATFORMS.has(platform)
}

export function getSelfHostedSignerUrl(): string | null {
  const raw = process.env.FLOW_PUBLISHER_SIGNER_URL?.trim()
  if (raw === 'disabled' || raw === 'off') return null
  return raw || DEFAULT_SELF_HOSTED_SIGNER_URL
}

export function shouldStartManagedSelfHostedSigner(): boolean {
  const managedRaw = process.env.FLOW_PUBLISHER_MANAGED_SIGNER?.trim().toLowerCase()
  if (!managedRaw || !['1', 'true', 'on', 'yes'].includes(managedRaw)) return false

  const raw = process.env.FLOW_PUBLISHER_SIGNER_URL?.trim()
  if (!raw) return isBuiltinLocalSignerEnabled()
  if (raw === 'disabled' || raw === 'off') return false

  const normalize = (value: string) => value
    .replace(/\/sign\/?$/, '')
    .replace(/\/$/, '')

  return isBuiltinLocalSignerEnabled() && normalize(raw) === DEFAULT_SELF_HOSTED_SIGNER_URL
}

export function isBuiltinLocalSignerEnabled(): boolean {
  const raw = process.env.FLOW_PUBLISHER_BUILTIN_SIGNER?.trim().toLowerCase()
  return raw !== 'disabled' && raw !== 'off' && raw !== 'false'
}

export function shouldAutoConfirmBuiltinSigner(): boolean {
  const raw = process.env.FLOW_PUBLISHER_AUTO_CONFIRM_BUILTIN_SIGNER?.trim().toLowerCase()
  if (!raw) return true
  return !['0', 'false', 'off', 'no', 'disabled'].includes(raw)
}

export function isLegacyExternalSignerEnabled(): boolean {
  return process.env.FLOW_PUBLISHER_ALLOW_LEGACY_EXTERNAL_SIGNER === 'true' ||
    hasLegacyExternalSignerConfig()
}

export function hasLegacyExternalSignerConfig(): boolean {
  return Boolean(
    process.env.FLOW_PUBLISHER_LEGACY_SIGNER_URL?.trim() ||
    process.env.FLOW_PUBLISHER_LEGACY_SIGNER_BASE_URL?.trim() ||
    process.env.FLOW_PUBLISHER_YIXIAOER_SIGNER_BASE_URL?.trim() ||
    process.env.FLOW_PUBLISHER_KUAISHOU_LEGACY_SIGNER_URL?.trim() ||
    process.env.FLOW_PUBLISHER_XIAOHONGSHU_LEGACY_SIGNER_URL?.trim() ||
    process.env.FLOW_PUBLISHER_XHS_LEGACY_SIGNER_URL?.trim()
  )
}

export function createSignerUnavailableError(platform: string, action?: string): Error {
  const platformName = getPlatformName(platform)

  return new Error(
    `${action || `${platformName}发布`}需要平台网页签名。本机自托管签名服务不可用，且内置本机签名未启用或生成失败。请启动本机 signer，或检查 FLOW_PUBLISHER_SIGNER_URL / FLOW_PUBLISHER_BUILTIN_SIGNER 配置。`
  )
}

export function createSignerPreflightError(platform: string, reason?: string): Error {
  const platformName = getPlatformName(platform)
  const detail = reason ? `当前检测结果：${reason}。` : ''

  if (platform === 'xiaohongshu') {
    return new Error(
      `${platformName}发布前签名预检失败。${detail}` +
      '小红书 note create 必须使用当前创作页生成的完整网页签名（X-s / X-t，并包含 X-S-Common 或 x-rap-param）；' +
      '请启动本机自托管 signer（默认 http://127.0.0.1:17321/sign），或在确认数据外发风险后配置小红书蚁小二兼容 signer。'
    )
  }

  return new Error(
    `${platformName}发布前签名预检失败。${detail}` +
    '该平台的网页 API 需要动态签名参数；请先启动本机 signer（默认 http://127.0.0.1:17321/sign），' +
    '或设置 FLOW_PUBLISHER_MANAGED_SIGNER=true 使用 App 托管 signer 后重启；' +
    '如果使用蚁小二兼容 signer，可配置 FLOW_PUBLISHER_LEGACY_SIGNER_URL 或按平台的 FLOW_PUBLISHER_KUAISHOU_LEGACY_SIGNER_URL / FLOW_PUBLISHER_XHS_LEGACY_SIGNER_URL。'
  )
}

export function shouldRethrowSignError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('本机自托管签名服务不可用') ||
    message.includes('已取消发布') ||
    message.includes('签名预检失败') ||
    message.includes('签名不完整')
}
