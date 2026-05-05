import { Spin, Typography, Image, Radio, Button, Space } from 'antd'
import { PictureOutlined, UploadOutlined } from '@ant-design/icons'
import type { VideoFrame } from '@/types/video.types'

const { Text } = Typography

interface Props {
  frames: VideoFrame[]
  loading: boolean
  selectedIndex: number | null
  customCoverPath: string | null
  onSelectFrame: (index: number) => void
  onSelectCustom: () => void
}

export default function CoverSelector({
  frames,
  loading,
  selectedIndex,
  customCoverPath,
  onSelectFrame,
  onSelectCustom
}: Props) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin tip="正在提取封面帧..." />
      </div>
    )
  }

  if (frames.length === 0 && !customCoverPath) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
        <PictureOutlined style={{ fontSize: 32, marginBottom: 8 }} />
        <div>
          <Text type="secondary">上传视频后将自动提取封面候选</Text>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text strong>选择封面</Text>
        <Button size="small" icon={<UploadOutlined />} onClick={onSelectCustom}>
          自定义封面
        </Button>
      </div>
      <Radio.Group
        value={customCoverPath ? 'custom' : selectedIndex}
        onChange={(e) => {
          if (e.target.value !== 'custom') onSelectFrame(e.target.value)
        }}
        style={{ width: '100%' }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {frames.map((frame, i) => (
            <div
              key={i}
              onClick={() => onSelectFrame(i)}
              style={{
                position: 'relative',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                border: selectedIndex === i && !customCoverPath ? '2px solid #1677ff' : '2px solid transparent',
                transition: 'border-color 0.2s'
              }}
            >
              <Image
                src={frame.dataUrl}
                width="100%"
                height={70}
                style={{ objectFit: 'cover', display: 'block' }}
                preview={false}
                fallback="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
              />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(0,0,0,0.5)', color: '#fff',
                fontSize: 10, textAlign: 'center', padding: '2px 0'
              }}>
                {Math.floor(frame.timestamp / 60)}:{String(Math.floor(frame.timestamp % 60)).padStart(2, '0')}
              </div>
            </div>
          ))}
          {customCoverPath && (
            <div
              onClick={() => {}}
              style={{
                position: 'relative',
                borderRadius: 6,
                overflow: 'hidden',
                cursor: 'pointer',
                border: '2px solid #1677ff'
              }}
            >
              <Image
                src={`file:///${customCoverPath.replace(/\\/g, '/')}`}
                width="100%"
                height={70}
                style={{ objectFit: 'cover', display: 'block' }}
                preview={false}
              />
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                background: 'rgba(22,119,255,0.7)', color: '#fff',
                fontSize: 10, textAlign: 'center', padding: '2px 0'
              }}>
                自定义
              </div>
            </div>
          )}
        </div>
      </Radio.Group>
      {customCoverPath && (
        <Space style={{ marginTop: 8 }}>
          <Button size="small" onClick={() => onSelectFrame(0)}>
            使用自动帧
          </Button>
        </Space>
      )}
    </div>
  )
}
