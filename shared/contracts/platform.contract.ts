// Shared platform contract types used by both main and renderer processes
// Will be populated in Phase 2+

export type PlatformId = 'douyin' | 'xiaohongshu' | 'wechat-channels' | 'kuaishou'

export type SessionStatus = 'logged_in' | 'expired' | 'not_logged_in'

export interface VideoConstraints {
  maxFileSizeMB: number
  maxDurationSec: number
  supportedFormats: string[]
}

/** Location data for POI mapping */
export interface LocationData {
  name: string
  lat: number
  lng: number
  poi_id: string
}

/** Cover data with multi-ratio support (方案A 1.3) */
export interface CoverData {
  horizontal_4_3: string | null
  vertical_3_4: string | null
  recommended: string[]
}

/** Publish time config (方案A 1.9) */
export interface PublishTimeConfig {
  mode: 'now' | 'scheduled'
  scheduled_at: string | null
}

/**
 * PlatformPublishContent — merged content passed to platform adapters.
 * Contains shared fields + platform-specific overrides already merged.
 * Per 方案A+方案C: shared fields are the base, overrides take precedence.
 */
export interface PlatformPublishContent {
  // Shared fields (方案A 通用区)
  title: string
  description: string
  hashtags: string[]
  mentions?: string[]
  location?: LocationData | null
  collection?: string | null
  visibility?: 'public' | 'friends' | 'private'
  publishTime?: PublishTimeConfig
  originalDeclaration?: boolean
  cover?: CoverData
  declarations: string[]

  // Cover file path (resolved from cover.horizontal_4_3 or legacy)
  coverPath?: string

  // Platform-specific fields (方案A 平台独有)
  platformFields?: Record<string, unknown>
}

export interface PublishResult {
  success: boolean
  platform: PlatformId
  publishUrl?: string
  error?: string
}
