import { useEffect, useRef } from 'react'
import { Tag, Space, Typography, Button } from 'antd'
import { DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { VideoMetadata } from '@/types/video.types'

const { Text } = Typography

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

  return (
    <div style={{ display: 'flex', gap: 16, padding: 16, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      <div style={{ position: 'relative', width: 240, minHeight: 135, borderRadius: 6, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
        <video
          ref={videoRef}
          src={`file:///${video.filePath.replace(/\\/g, '/')}`}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          controls
          preload="metadata"
        />
        <PlayCircleOutlined
          style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', fontSize: 36, color: 'rgba(255,255,255,0.8)', pointerEvents: 'none' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <Text strong style={{ fontSize: 14, wordBreak: 'break-all' }}>{video.fileName}</Text>
          <Space size={8} style={{ marginTop: 8 }} wrap>
            <Tag>{video.format.toUpperCase()}</Tag>
            <Tag>{video.width}x{video.height}</Tag>
            <Tag>{formatDuration(video.duration)}</Tag>
            <Tag>{formatFileSize(video.fileSize)}</Tag>
            {video.fps > 0 && <Tag>{video.fps} fps</Tag>}
          </Space>
        </div>
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={onRemove}
          style={{ alignSelf: 'flex-start' }}
        >
          移除视频
        </Button>
      </div>
    </div>
  )
}
