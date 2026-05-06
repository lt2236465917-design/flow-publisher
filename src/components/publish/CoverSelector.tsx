import { useState } from 'react'
import { Spin, Typography, Image, message } from 'antd'
import { PictureOutlined, UploadOutlined, SwapOutlined } from '@ant-design/icons'
import type { VideoFrame } from '@/types/video.types'
import CropModal from './CropModal'

const { Text } = Typography

interface Props {
  frames: VideoFrame[]
  loading: boolean
  selectedIndex: number | null
  horizontalCover: string | null
  verticalCover: string | null
  onSelectFrame: (index: number | null) => void
  /** Opens file dialog, returns data URL of selected image */
  onPickImage: () => Promise<string | null>
  onCropConfirm: (type: 'horizontal' | 'vertical', croppedDataUrl: string) => void
}

export default function CoverSelector({
  frames,
  loading,
  selectedIndex,
  horizontalCover,
  verticalCover,
  onSelectFrame,
  onPickImage,
  onCropConfirm
}: Props) {
  const [cropTarget, setCropTarget] = useState<'horizontal' | 'vertical' | null>(null)
  const [cropImageSrc, setCropImageSrc] = useState<string>('')

  const openCrop = (target: 'horizontal' | 'vertical', imageSrc: string) => {
    setCropTarget(target)
    setCropImageSrc(imageSrc)
  }

  const handleUpload = async (target: 'horizontal' | 'vertical') => {
    const dataUrl = await onPickImage()
    if (!dataUrl) return
    if (!dataUrl.startsWith('data:image/')) {
      message.error('选择的文件不是有效图片')
      return
    }
    openCrop(target, dataUrl)
  }

  // Click on cover box: crop existing image, or upload new one
  const handleClickCover = (target: 'horizontal' | 'vertical', coverSrc: string | null, frameSrc: string | null) => {
    const src = coverSrc || frameSrc
    if (src) {
      openCrop(target, src)
    } else {
      handleUpload(target)
    }
  }

  const handleCropConfirm = (croppedDataUrl: string) => {
    if (cropTarget) {
      onCropConfirm(cropTarget, croppedDataUrl)
    }
    setCropTarget(null)
    setCropImageSrc('')
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 32 }}>
        <Spin tip="正在提取封面帧..." />
      </div>
    )
  }

  const selectedFrameSrc = selectedIndex !== null && frames[selectedIndex]
    ? frames[selectedIndex].dataUrl
    : null

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {/* Left: Custom covers */}
      <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
        <CoverBox
          label="横版封面"
          ratio="4:3"
          width={180}
          height={135}
          coverSrc={horizontalCover}
          fallbackSrc={selectedFrameSrc}
          onClick={() => handleClickCover('horizontal', horizontalCover, selectedFrameSrc)}
          onReplace={() => handleUpload('horizontal')}
        />

        <CoverBox
          label="竖版封面"
          ratio="3:4"
          width={101}
          height={135}
          coverSrc={verticalCover}
          fallbackSrc={selectedFrameSrc}
          onClick={() => handleClickCover('vertical', verticalCover, selectedFrameSrc)}
          onReplace={() => handleUpload('vertical')}
        />
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: '#f0f0f0', flexShrink: 0 }} />

      {/* Right: Recommended frames */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>智能推荐</Text>
        {frames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
            <PictureOutlined style={{ fontSize: 24, marginBottom: 8 }} />
            <div><Text type="secondary">上传视频后将自动推荐封面</Text></div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            {frames.map((frame, i) => (
              <div
                key={i}
                onClick={() => onSelectFrame(selectedIndex === i ? null : i)}
                style={{
                  position: 'relative',
                  flex: '1 1 0',
                  minWidth: 0,
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: selectedIndex === i ? '2px solid #1677ff' : '2px solid #f0f0f0',
                  transition: 'border-color 0.2s',
                  aspectRatio: '16 / 9'
                }}
              >
                <Image
                  src={frame.dataUrl}
                  width="100%"
                  height="100%"
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
                {selectedIndex === i && (
                  <div style={{
                    position: 'absolute', top: 4, right: 4,
                    background: '#1677ff', color: '#fff',
                    fontSize: 10, padding: '1px 6px', borderRadius: 4
                  }}>
                    已选
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Crop Modal */}
      <CropModal
        visible={cropTarget !== null}
        imageSrc={cropImageSrc}
        aspect={cropTarget === 'horizontal' ? 4 / 3 : 3 / 4}
        title={cropTarget === 'horizontal' ? '裁剪横版封面' : '裁剪竖版封面'}
        onConfirm={handleCropConfirm}
        onCancel={() => { setCropTarget(null); setCropImageSrc('') }}
      />
    </div>
  )
}

/* Single cover box */
function CoverBox({
  label,
  ratio,
  width,
  height,
  coverSrc,
  fallbackSrc,
  onClick,
  onReplace
}: {
  label: string
  ratio: string
  width: number
  height: number
  coverSrc: string | null
  fallbackSrc: string | null
  onClick: () => void
  onReplace: () => void
}) {
  const displaySrc = coverSrc || fallbackSrc
  const hasCustomCover = !!coverSrc
  const hasFallback = !!fallbackSrc

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
        {label} ({ratio})
      </div>
      <div
        style={{
          width,
          height,
          borderRadius: 8,
          overflow: 'hidden',
          border: '2px dashed #d9d9d9',
          cursor: 'pointer',
          position: 'relative',
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.2s'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1677ff' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#d9d9d9' }}
      >
        {displaySrc ? (
          <>
            <img
              src={displaySrc}
              onClick={onClick}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            />
            {/* Bottom bar */}
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              background: 'rgba(0,0,0,0.5)', color: '#fff',
              fontSize: 11, padding: '4px 0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12
            }}>
              <span
                onClick={onClick}
                style={{ cursor: 'pointer' }}
              >
                裁剪
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); onReplace() }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
              >
                <SwapOutlined /> 更换
              </span>
            </div>
            {/* Fallback indicator */}
            {!hasCustomCover && hasFallback && (
              <div style={{
                position: 'absolute', top: 4, left: 4,
                background: 'rgba(0,0,0,0.5)', color: '#fff',
                fontSize: 9, padding: '1px 5px', borderRadius: 3
              }}>
                推荐
              </div>
            )}
          </>
        ) : (
          <div onClick={onClick} style={{ color: '#bbb', fontSize: 12, cursor: 'pointer' }}>
            <UploadOutlined style={{ fontSize: 20, display: 'block', marginBottom: 4 }} />
            点击上传
          </div>
        )}
      </div>
    </div>
  )
}
