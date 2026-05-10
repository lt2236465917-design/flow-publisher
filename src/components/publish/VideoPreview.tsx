import { useEffect, useRef } from 'react'
import { DeleteOutlined } from '@ant-design/icons'
import type { VideoMetadata } from '@/types/video.types'

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

  const videoSrc = `local-file://${video.filePath.replace(/\\/g, '/')}`

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: 14,
        background: '#f5f5f7',
        borderRadius: 12,
        marginTop: 12,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 180,
          minHeight: 100,
          borderRadius: 10,
          overflow: 'hidden',
          background: '#000',
          flexShrink: 0,
        }}
      >
        <video
          ref={videoRef}
          src={videoSrc}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          controls
          preload="metadata"
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0 }}>
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1d1d1f',
              wordBreak: 'break-all',
              marginBottom: 8,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            {video.fileName}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <MetaTag>{video.format.toUpperCase()}</MetaTag>
            <MetaTag>{video.width}×{video.height}</MetaTag>
            <MetaTag>{formatDuration(video.duration)}</MetaTag>
            <MetaTag>{formatFileSize(video.fileSize)}</MetaTag>
            {video.fps > 0 && <MetaTag>{video.fps}fps</MetaTag>}
          </div>
        </div>
        <button
          onClick={onRemove}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            border: 'none',
            background: 'transparent',
            color: '#ff3b30',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            borderRadius: 6,
            transition: 'background 0.15s ease',
            fontFamily: "'DM Sans', sans-serif",
            alignSelf: 'flex-start',
            marginTop: 8,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 59, 48, 0.06)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        >
          <DeleteOutlined style={{ fontSize: 12 }} />
          移除
        </button>
      </div>
    </div>
  )
}

function MetaTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: '#86868b',
        background: 'rgba(0, 0, 0, 0.04)',
        padding: '2px 8px',
        borderRadius: 6,
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </span>
  )
}
