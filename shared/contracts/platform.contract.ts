// Shared platform contract types used by both main and renderer processes
// Will be populated in Phase 2+

export type PlatformId = 'douyin' | 'xiaohongshu' | 'wechat-channels' | 'kuaishou'

export type SessionStatus = 'logged_in' | 'expired' | 'not_logged_in'

export interface VideoConstraints {
  maxFileSizeMB: number
  maxDurationSec: number
  supportedFormats: string[]
}

export interface PlatformPublishContent {
  title: string
  description: string
  hashtags: string[]
  coverPath?: string
  declarations: string[]
  platformFields?: Record<string, unknown>
}

export interface PublishResult {
  success: boolean
  platform: PlatformId
  publishUrl?: string
  error?: string
}
