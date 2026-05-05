import type { PlatformId } from '@/constants/platforms'

export type SessionStatus = 'logged_in' | 'expired' | 'not_logged_in'

export interface AccountInfo {
  id: string
  platform: PlatformId
  displayName: string
  avatarUrl?: string
  sessionStatus: SessionStatus
  lastLoginAt?: string
}

export interface VideoConstraints {
  maxFileSizeMB: number
  maxDurationSec: number
  supportedFormats: string[]
  maxWidth: number
  maxHeight: number
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
