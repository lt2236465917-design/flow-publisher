import { useCallback, useState } from 'react'
import { InboxOutlined } from '@ant-design/icons'
import { Typography, message } from 'antd'
import type { VideoMetadata } from '@/types/video.types'

const { Text } = Typography

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
    setDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)

    const files = e.dataTransfer.files
    if (files.length === 0) return

    const file = files[0]
    const filePath = window.api.getPathForFile(file)
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
        border: `2px dashed ${dragging ? '#1677ff' : '#d9d9d9'}`,
        borderRadius: 12,
        padding: '60px 40px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? '#f0f5ff' : '#fafafa',
        transition: 'border-color 0.2s, background 0.2s'
      }}
    >
      <InboxOutlined style={{ fontSize: 48, color: dragging ? '#1677ff' : '#999', marginBottom: 16 }} />
      <div>
        <Text strong style={{ fontSize: 16 }}>点击或拖拽视频文件到此处</Text>
      </div>
      <div style={{ marginTop: 8 }}>
        <Text type="secondary">支持 MP4、MOV、AVI、FLV、MKV、WMV 格式</Text>
      </div>
    </div>
  )
}
