import type { PlatformFieldDefinition } from '../../../shared/types/platform-fields'
import type { HttpClient } from '../http/HttpClient'
import type {
  SubmitResult,
  VideoListResult,
  VideoDetailResult
} from '../../../shared/types/analytics'

export interface LoginResult {
  success: boolean
  displayName?: string
  avatarUrl?: string
  error?: string
}

export interface VideoConstraints {
  maxFileSizeMB: number
  maxDurationSec: number
  supportedFormats: string[]
}

export interface UploadProgress {
  percent: number
  stage: string
}

export interface LocationResult {
  id: string
  name: string
  address?: string
  lat?: number
  lng?: number
  poi_id?: string
  extra?: Record<string, unknown>
}

export interface LocationSearchOptions {
  lat?: number
  lng?: number
  count?: number
  /** Current city name from IP location, used to add a city-level option to results */
  city?: string
}

export interface VideoMetadata {
  width: number
  height: number
  duration: number
  fps: number
  bitrate: number
  format: string
}

/**
 * Structured upload result — returned by uploadVideoAPI, consumed by submitContentAPI.
 * Eliminates mutable instance fields (H11 fix) and survives app crashes (H7 fix).
 */
export interface UploadResult {
  videoId: string
  meta: Record<string, unknown>
}

export interface UploadVideoOptions {
  /** If false, upload may continue after videoId is accepted without waiting for server first-frame extraction. */
  waitForServerCover?: boolean
}

export interface SubmitContentPayload {
  /** DB record ID — used to read upload metadata persisted by the caller (H7 + H11 fix) */
  recordId?: string
  /** Original local video path, used by browser-page fallbacks that upload through the official creator UI. */
  videoPath?: string
  title: string
  description: string
  hashtags: string[]
  coverPath?: string
  declarations: string[]
  /** Shared cover data from the form (horizontal/vertical data URLs) */
  cover?: { horizontal_4_3: string | null; vertical_3_4: string | null; recommended: string[] }
  /** Platform-specific field overrides (e.g. collection, poiLocation, declarations, downloadPermission) */
  platformFields?: Record<string, unknown>
  /** Actual video metadata from ffmpeg probe (width, height, duration, fps, etc.) */
  videoMetadata?: VideoMetadata
}

// ---- Focused sub-interfaces for capability-based type safety (M9 fix) ----

/** Adapters that support API-based video publishing */
export interface IPublishable {
  uploadVideoAPI(client: HttpClient, filePath: string, onProgress?: (p: UploadProgress) => void, options?: UploadVideoOptions): Promise<string | UploadResult | void>
  submitContentAPI(client: HttpClient, payload: SubmitContentPayload, videoId?: string, coverFileId?: string): Promise<SubmitResult>
  getVideoConstraints(): VideoConstraints
}

/** Adapters that support session validity checks */
export interface ISessionCheckable {
  checkSessionAPI(client: HttpClient): Promise<boolean>
  getAccountInfoAPI(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null>
}

/** Adapters that support analytics data collection */
export interface IAnalyticsCapable {
  getVideoList(client: HttpClient, options?: { cursor?: string; pageSize?: number }): Promise<VideoListResult>
  getVideoDetail?(client: HttpClient, contentId: string): Promise<VideoDetailResult | null>
}

/** Adapters that support location search/recommendation */
export interface ILocationCapable {
  searchLocation(client: HttpClient, keyword: string, options?: LocationSearchOptions): Promise<LocationResult[]>
  getRecommendLocations(client: HttpClient, options?: LocationSearchOptions): Promise<LocationResult[]>
}

/** Adapters that support collection/album listing */
export interface ICollectionCapable {
  getCollections(client: HttpClient): Promise<Array<{ label: string; value: string }>>
}

// ---- Capability check helpers ----

export function canPublish(a: IPlatformAdapter): a is IPlatformAdapter & IPublishable {
  return typeof (a as any).uploadVideoAPI === 'function' && typeof (a as any).submitContentAPI === 'function'
}

export function canCheckSession(a: IPlatformAdapter): a is IPlatformAdapter & ISessionCheckable {
  return typeof (a as any).checkSessionAPI === 'function'
}

export function canCollectAnalytics(a: IPlatformAdapter): a is IPlatformAdapter & IAnalyticsCapable {
  return typeof (a as any).getVideoList === 'function'
}

export function canSearchLocation(a: IPlatformAdapter): a is IPlatformAdapter & ILocationCapable {
  return typeof (a as any).searchLocation === 'function'
}

// ---- Main adapter interface (methods are optional for backward compat) ----

export interface IPlatformAdapter {
  readonly platformId: string
  readonly platformName: string
  readonly loginUrl: string

  // Platform fields (always available — all adapters implement this)
  getPlatformFields(): PlatformFieldDefinition[]

  // Publish — API mode (HTTP-based, no browser automation)
  getVideoConstraints?(): VideoConstraints
  uploadVideoAPI?(client: HttpClient, filePath: string, onProgress?: (p: UploadProgress) => void, options?: UploadVideoOptions): Promise<string | UploadResult | void>
  uploadCoverImageAPI?(client: HttpClient, imagePath: string, onProgress?: (p: UploadProgress) => void): Promise<string>
  submitContentAPI?(client: HttpClient, payload: SubmitContentPayload, videoId?: string, coverFileId?: string): Promise<SubmitResult>
  checkSessionAPI?(client: HttpClient): Promise<boolean>
  getAccountInfoAPI?(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null>
  searchLocation?(client: HttpClient, keyword: string, options?: LocationSearchOptions): Promise<LocationResult[]>
  getRecommendLocations?(client: HttpClient, options?: LocationSearchOptions): Promise<LocationResult[]>
  getCollections?(client: HttpClient): Promise<Array<{ label: string; value: string }>>

  // ---- Analytics (数据采集) ----
  getVideoList?(client: HttpClient, options?: { cursor?: string; pageSize?: number }): Promise<VideoListResult>
  getVideoDetail?(client: HttpClient, contentId: string): Promise<VideoDetailResult | null>
}
