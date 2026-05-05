export interface VideoMetadata {
  filePath: string
  fileName: string
  fileSize: number
  duration: number
  width: number
  height: number
  format: string
  bitrate: number
  fps: number
  thumbnailPath?: string
}

export interface VideoFrame {
  index: number
  timestamp: number
  dataUrl: string
}

export interface VideoValidationResult {
  valid: boolean
  errors: string[]
}
