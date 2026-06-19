import { useCallback, useState } from 'react'
import { InboxOutlined } from '@ant-design/icons'
import { message } from 'antd'
import type { VideoMetadata } from '@/types/video.types'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.flv', '.mkv', '.wmv', '.webm']

interface Props {
  video: VideoMetadata | null
  onSelect: () => void
  onDropFile: (filePath: string) => void
}

export default function VideoDropZone({ video, onSelect, onDropFile }: Props) {
  const [dragging, setDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false when actually leaving the drop zone (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)

    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    let filePath: string
    try {
      filePath = await window.api.getPathForFile(file)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法读取拖拽文件')
      return
    }
    const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))

    if (!VIDEO_EXTENSIONS.includes(ext)) {
      message.error('不支持的文件格式，请选择视频文件')
      return
    }

    onDropFile(filePath)
  }, [onDropFile])

  if (video) return null

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={onSelect}
      style={{
        border: `2px dashed ${dragging ? '#0071e3' : 'rgba(0, 0, 0, 0.1)'}`,
        borderRadius: 14,
        padding: '40px 48px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? 'rgba(0, 113, 227, 0.04)' : '#fafafa',
        transition: 'all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      }}
    >
      <InboxOutlined
        style={{
          fontSize: 40,
          color: dragging ? '#0071e3' : '#d2d2d7',
          marginBottom: 12,
          display: 'block',
          transition: 'color 0.25s ease',
        }}
      />
      <div
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: 14,
          fontWeight: 600,
          color: '#1d1d1f',
          marginBottom: 6,
          letterSpacing: '-0.01em',
        }}
      >
        点击或拖拽视频文件到此处
      </div>
      <div style={{ fontSize: 12, color: '#aeaeb2' }}>
        支持 MP4、MOV、AVI、FLV、MKV、WMV、WebM 格式
      </div>
    </div>
  )
}
