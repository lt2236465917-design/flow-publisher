import { useEffect, useRef } from 'react'
import { DeleteOutlined } from '@ant-design/icons'
import type { VideoMetadata } from '@/types/video.types'
import { toLocalFileUrl } from '@/utils/localFileUrl'
import './VideoPreview.css'

interface Props {
  video: VideoMetadata
  onRemove: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function VideoPreview({ video, onRemove }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load()
    }
  }, [video.filePath])

  const videoSrc = toLocalFileUrl(video.filePath)

  return (
    <div className="video-preview-card">
      <div className="video-preview-media">
        <video
          ref={videoRef}
          src={videoSrc}
          className="video-preview-player"
          controls
          preload="metadata"
        />
      </div>
      <div className="video-preview-info">
        <div className="video-preview-content">
          <div className="video-preview-heading">
            <span className="video-preview-eyebrow">已选择视频</span>
            <div className="video-preview-filename" title={video.fileName}>
              {video.fileName}
            </div>
          </div>

          <div className="video-preview-meta" aria-label="视频参数">
            <MetaItem label="格式" value={video.format.toUpperCase()} />
            <MetaItem label="分辨率" value={`${video.width} × ${video.height}`} />
            <MetaItem label="时长" value={formatDuration(video.duration)} />
            <MetaItem label="大小" value={formatFileSize(video.fileSize)} />
            {video.fps > 0 && <MetaItem label="帧率" value={`${video.fps} fps`} />}
          </div>
        </div>

        <div className="video-preview-actions">
          <span className="video-preview-hint">视频参数已读取</span>
          <button
            type="button"
            onClick={onRemove}
            className="video-preview-remove"
          >
            <DeleteOutlined />
            移除视频
          </button>
        </div>
      </div>
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="video-preview-meta-item">
      <span className="video-preview-meta-label">{label}</span>
      <span className="video-preview-meta-value">{value}</span>
    </div>
  )
}
