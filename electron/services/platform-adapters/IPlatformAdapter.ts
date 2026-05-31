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

export interface SubmitContentPayload {
  title: string
  description: string
  hashtags: string[]
  coverPath?: string
  declarations: string[]
  platformFields?: Record<string, unknown>
}

export interface IPlatformAdapter {
  readonly platformId: string
  readonly platformName: string
  readonly loginUrl: string

  // Publish — API mode (HTTP-based, no browser automation)
  getVideoConstraints?(): VideoConstraints
  uploadVideoAPI?(client: HttpClient, filePath: string, onProgress?: (p: UploadProgress) => void): Promise<string | void>
  submitContentAPI?(client: HttpClient, payload: SubmitContentPayload, videoId?: string): Promise<void>
  checkSessionAPI?(client: HttpClient): Promise<boolean>
  getPlatformFields?(): PlatformFieldDefinition[]
  getAccountInfoAPI?(client: HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null>
  searchLocation?(client: HttpClient, keyword: string): Promise<LocationResult[]>
}
