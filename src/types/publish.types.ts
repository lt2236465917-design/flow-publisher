import type { PlatformId } from '@/constants/platforms'
import type { VideoMetadata, VideoFrame } from './video.types'

export type PublishStatus = 'idle' | 'preparing' | 'uploading' | 'submitting' | 'done' | 'error'

export interface PublishFormData {
  title: string
  description: string
  hashtags: string[]
  coverPath: string | null
  coverFrameIndex: number | null
  coverRatio: '4:3' | '3:4'
  horizontalCover: string | null
  verticalCover: string | null
  declarations: string[]
  platforms: PlatformId[]
  platformOverrides: Record<PlatformId, Record<string, unknown>>
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
