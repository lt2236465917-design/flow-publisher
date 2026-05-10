import { useEffect, useRef } from 'react'
import { Tag, Space, Typography, Button } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
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

  const videoSrc = `local-file://${video.filePath.replace(/\\/g, '/')}`

  return (
    <div style={{ display: 'flex', gap: 12, padding: 10, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0', marginTop: 8 }}>
      <div style={{ position: 'relative', width: 160, minHeight: 90, borderRadius: 6, overflow: 'hidden', background: '#000', flexShrink: 0 }}>
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
          <Text strong style={{ fontSize: 13, wordBreak: 'break-all', display: 'block' }}>{video.fileName}</Text>
          <Space size={4} style={{ marginTop: 4 }} wrap>
            <Tag style={{ fontSize: 11 }}>{video.format.toUpperCase()}</Tag>
            <Tag style={{ fontSize: 11 }}>{video.width}x{video.height}</Tag>
            <Tag style={{ fontSize: 11 }}>{formatDuration(video.duration)}</Tag>
            <Tag style={{ fontSize: 11 }}>{formatFileSize(video.fileSize)}</Tag>
            {video.fps > 0 && <Tag style={{ fontSize: 11 }}>{video.fps}fps</Tag>}
          </Space>
        </div>
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={onRemove}
          style={{ alignSelf: 'flex-start', padding: '0 4px' }}
        >
          移除
        </Button>
      </div>
    </div>
  )
}
