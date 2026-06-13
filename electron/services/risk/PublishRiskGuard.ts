import { delay } from '../../utils/delays'
import { logger } from '../../utils/logger'

export type PublishRiskStage = 'upload' | 'submit'

export interface RiskGuardProgress {
  percent: number
  stage: string
}

export interface PublishRiskGuardOptions {
  accountId: string
  platformId: string
  stage: PublishRiskStage
  recordId?: string
  onProgress?: (progress: RiskGuardProgress) => void
}

interface CooldownState {
  until: number
  reason: string
}

const DEFAULT_MIN_SUBMIT_INTERVAL_MS = 60_000
const DEFAULT_RISK_COOLDOWN_MS = 10 * 60_000

const PLATFORM_NAMES: Record<string, string> = {
  douyin: '抖音',
  xiaohongshu: '小红书',
  kuaishou: '快手',
  'wechat-channels': '视频号'
}

function readDurationEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function formatSeconds(ms: number): string {
  return `${Math.ceil(ms / 1000)}秒`
}

function getPlatformName(platformId: string): string {
  return PLATFORM_NAMES[platformId] || platformId
}

function isRiskLikeFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/账号登录状态异常或已过期|请先重新登录/.test(message)) return false

  const normalized = message.toLowerCase()
  return [
    '403',
    'captcha',
    'verify',
    'risk',
    'too frequent',
    '风控',
    '安全',
    '验证',
    '频繁',
    '异常',
    '账号风险'
  ].some((token) => normalized.includes(token.toLowerCase()))
}

/**
 * Local guardrail for account-safety posture.
 *
 * This does not try to bypass platform checks. It keeps publish operations
 * conservative: no concurrent publish for the same account/platform, a minimum
 * spacing between submissions, and a cooldown after risk-like failures.
 */
export class PublishRiskGuard {
  private activeKeys = new Set<string>()
  private lastSubmitAt = new Map<string, number>()
  private cooldowns = new Map<string, CooldownState>()

  async run<T>(options: PublishRiskGuardOptions, operation: () => Promise<T>): Promise<T> {
    const key = this.keyFor(options)
    await this.enter(options, key)

    try {
      const result = await operation()
      this.afterSuccess(options, key)
      return result
    } catch (error) {
      this.afterFailure(options, key, error)
      throw error
    } finally {
      this.activeKeys.delete(key)
    }
  }

  private async enter(options: PublishRiskGuardOptions, key: string): Promise<void> {
    const platformName = getPlatformName(options.platformId)
    if (this.activeKeys.has(key)) {
      throw new Error(`${platformName}账号已有发布流程正在进行。为降低账号风险，请等待当前任务完成后再发布。`)
    }

    const now = Date.now()
    const cooldown = this.cooldowns.get(key)
    if (cooldown && cooldown.until > now) {
      throw new Error(
        `${platformName}账号刚遇到可能的风控/验证错误，已进入冷却。` +
        `请等待 ${formatSeconds(cooldown.until - now)} 后再试。原因：${cooldown.reason}`
      )
    }

    this.activeKeys.add(key)

    if (options.stage === 'submit') {
      const minInterval = readDurationEnv('FLOW_PUBLISHER_MIN_SUBMIT_INTERVAL_MS', DEFAULT_MIN_SUBMIT_INTERVAL_MS)
      const lastSubmit = this.lastSubmitAt.get(key) || 0
      const waitMs = Math.max(0, minInterval - (now - lastSubmit))

      if (waitMs > 0) {
        const stage = `为降低账号风险，等待 ${formatSeconds(waitMs)} 后提交到${platformName}`
        logger.info(`[risk-guard] ${stage}`)
        options.onProgress?.({ percent: 89, stage })
        await delay(waitMs)
      }
    }
  }

  private afterSuccess(options: PublishRiskGuardOptions, key: string): void {
    if (options.stage === 'submit') {
      this.lastSubmitAt.set(key, Date.now())
    }
  }

  private afterFailure(options: PublishRiskGuardOptions, key: string, error: unknown): void {
    if (!isRiskLikeFailure(error)) return

    const cooldownMs = readDurationEnv('FLOW_PUBLISHER_RISK_COOLDOWN_MS', DEFAULT_RISK_COOLDOWN_MS)
    if (cooldownMs <= 0) return

    const reason = error instanceof Error ? error.message : String(error)
    this.cooldowns.set(key, {
      until: Date.now() + cooldownMs,
      reason: reason.slice(0, 300)
    })
    logger.warn(
      `[risk-guard] Cooling down ${options.platformId}/${options.accountId} for ${formatSeconds(cooldownMs)} after risk-like failure: ${reason}`
    )
  }

  private keyFor(options: PublishRiskGuardOptions): string {
    return `${options.accountId}:${options.platformId}`
  }
}

let publishRiskGuard: PublishRiskGuard | null = null

export function getPublishRiskGuard(): PublishRiskGuard {
  if (!publishRiskGuard) publishRiskGuard = new PublishRiskGuard()
  return publishRiskGuard
}
