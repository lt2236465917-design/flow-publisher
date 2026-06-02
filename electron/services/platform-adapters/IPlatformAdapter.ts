import type { PlatformFieldDefinition } from '../../shared/types/platform-fields'
import type { HttpClient } from '../http/HttpClient'

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

export interface SubmitContentPayload {
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

export interface IPlatformAdapter {
  readonly platformId: string
  readonly platformName: string
  readonly loginUrl: string

  // Publish — API mode (HTTP-based, no browser automation)
  getVideoConstraints?(): VideoConstraints
  uploadVideoAPI?(client: HttpClient, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<string | void>
  uploadCoverImageAPI?(client: HttpClient, imagePath: string, onProgress?: (p: UploadProgress) => void): Promise<string>
  submitContentAPI?(client: HttpClient, payload: SubmitContentPayload, videoId?: string, coverFileId?: string): Promise<void>
  checkSessionAPI?(client: HttpClient): Promise<boolean>
  getPlatformFields?(): PlatformFieldDefinition[]
  getAccountInfoAPI?(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null>
  searchLocation?(client: HttpClient, keyword: string, options?: LocationSearchOptions): Promise<LocationResult[]>
  getRecommendLocations?(client: HttpClient, options?: LocationSearchOptions): Promise<LocationResult[]>
  getCollections?(client: HttpClient): Promise<Array<{ label: string; value: string }>>
}
