import type { PlatformId } from '@/constants/platforms'
import type { VideoMetadata, VideoFrame } from './video.types'

export type PublishStatus = 'idle' | 'preparing' | 'uploading' | 'submitting' | 'done' | 'error'

/** Cover data matching 方案C schema: horizontal + vertical + recommended candidates */
export interface CoverData {
  horizontal_4_3: string | null
  vertical_3_4: string | null
  recommended: string[]
}

/** Location data for POI */
export interface LocationData {
  name: string
  lat: number
  lng: number
  poi_id: string
}

/** Publish time config */
export interface PublishTimeConfig {
  mode: 'now' | 'scheduled'
  scheduled_at: string | null
}

/**
 * PublishFormData — restructured to match 方案A+方案C:
 * - Shared fields (edited once, synced to all platforms)
 * - Platform overrides (per-platform customization, inherits from shared)
 *
 * Legacy flat fields (title, coverPath, etc.) preserved for UI compatibility.
 */
export interface PublishFormData {
  // === Shared fields (通用区) ===
  title: string
  description: string
  hashtags: string[]
  mentions: string[]
  location: LocationData | null
  collection: string | null
  visibility: 'public' | 'friends' | 'private'
  publishTime: PublishTimeConfig
  originalDeclaration: boolean
  cover: CoverData
  declarations: string[]

  // === Platform selection ===
  platforms: PlatformId[]

  /**
   * Per-platform overrides.
   * Each platform inherits all shared fields by default.
   * Only explicitly set fields here override the shared values.
   * Merged at publish time: { ...shared, ...platformOverrides[platformId] }
   */
  platformOverrides: Record<PlatformId, Record<string, unknown>>

  // === Legacy fields (kept for UI component compatibility) ===
  coverPath: string | null
  coverFrameIndex: number | null
  coverRatio: '4:3' | '3:4'
  horizontalCover: string | null
  verticalCover: string | null
}

export interface PublishTask {
  id: string
  platform: PlatformId
  status: PublishStatus
  progress: number
  error?: string
  publishUrl?: string
}

export interface PublishRecord {
  id: string
  platform: string
  title: string
  description: string
  videoPath: string
  coverPath: string | null
  status: string
  publishUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface PublishState {
  video: VideoMetadata | null
  frames: VideoFrame[]
  form: PublishFormData
  tasks: PublishTask[]
  loading: boolean
  extractingFrames: boolean

  setVideo: (video: VideoMetadata | null) => void
  setFrames: (frames: VideoFrame[]) => void
  updateForm: (patch: Partial<PublishFormData>) => void
  resetForm: () => void
  setTasks: (tasks: PublishTask[]) => void
  updateTask: (taskId: string, patch: Partial<PublishTask>) => void
  setLoading: (v: boolean) => void
  setExtractingFrames: (v: boolean) => void
}
