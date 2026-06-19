import { useState } from 'react'
import { Spin, Image, message } from 'antd'
import { PictureOutlined, UploadOutlined, SwapOutlined } from '@ant-design/icons'
import type { VideoFrame } from '@/types/video.types'
import CropModal from './CropModal'

interface Props {
  frames: VideoFrame[]
  loading: boolean
  selectedIndex: number | null
  horizontalCover: string | null
  verticalCover: string | null
  onSelectFrame: (index: number | null) => void
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
    onSelectFrame(null)
    openCrop(target, dataUrl)
  }

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
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin tip="正在提取封面帧..." />
      </div>
    )
  }

  const selectedFrameSrc = selectedIndex !== null && frames[selectedIndex]
    ? frames[selectedIndex].dataUrl
    : null

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Custom covers */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
        <CoverBox
          label="横版 4:3"
          width={148}
          height={111}
          coverSrc={horizontalCover}
          fallbackSrc={selectedFrameSrc}
          onClick={() => handleClickCover('horizontal', horizontalCover, selectedFrameSrc)}
          onReplace={() => handleUpload('horizontal')}
        />
        <CoverBox
          label="竖版 3:4"
          width={83}
          height={111}
          coverSrc={verticalCover}
          fallbackSrc={selectedFrameSrc}
          onClick={() => handleClickCover('vertical', verticalCover, selectedFrameSrc)}
          onReplace={() => handleUpload('vertical')}
        />
      </div>

      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(0, 0, 0, 0.06)', flexShrink: 0, alignSelf: 'stretch' }} />

      {/* Recommended frames */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#86868b',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 10,
          }}
        >
          智能推荐
        </div>
        {frames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#d2d2d7' }}>
            <PictureOutlined style={{ fontSize: 24, marginBottom: 6, display: 'block' }} />
            <div style={{ fontSize: 12, color: '#aeaeb2' }}>上传视频后将自动推荐封面</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
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
                  border: selectedIndex === i ? '2px solid #0071e3' : '2px solid transparent',
                  outline: selectedIndex === i ? 'none' : '1px solid rgba(0, 0, 0, 0.06)',
                  transition: 'all 0.2s ease',
                  aspectRatio: '16 / 9',
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
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                    color: '#fff',
                    fontSize: 10,
                    textAlign: 'center',
                    padding: '8px 0 4px',
                    fontWeight: 500,
                  }}
                >
                  {Math.floor(frame.timestamp / 60)}:{String(Math.floor(frame.timestamp % 60)).padStart(2, '0')}
                </div>
                {selectedIndex === i && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      background: '#0071e3',
                      color: '#fff',
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      letterSpacing: '0.03em',
                    }}
                  >
                    已选
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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

function CoverBox({
  label,
  width,
  height,
  coverSrc,
  fallbackSrc,
  onClick,
  onReplace
}: {
  label: string
  width: number
  height: number
  coverSrc: string | null
  fallbackSrc: string | null
  onClick: () => void
  onReplace: () => void
}) {
  const displaySrc = coverSrc || fallbackSrc
  const hasCustomCover = !!coverSrc

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#86868b', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          width,
          height,
          borderRadius: 10,
          overflow: 'hidden',
          border: displaySrc ? '1px solid rgba(0, 0, 0, 0.06)' : '2px dashed rgba(0, 0, 0, 0.1)',
          cursor: 'pointer',
          position: 'relative',
          background: displaySrc ? 'transparent' : '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#0071e3' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = displaySrc ? 'rgba(0, 0, 0, 0.06)' : 'rgba(0, 0, 0, 0.1)' }}
      >
        {displaySrc ? (
          <>
            <img
              src={displaySrc}
              onClick={onClick}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                color: '#fff',
                fontSize: 11,
                padding: '12px 0 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                fontWeight: 500,
              }}
            >
              <span onClick={onClick} style={{ cursor: 'pointer' }}>裁剪</span>
              <span
                onClick={(e) => { e.stopPropagation(); onReplace() }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
              >
                <SwapOutlined style={{ fontSize: 10 }} /> 更换
              </span>
            </div>
            {!hasCustomCover && (
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  left: 4,
                  background: 'rgba(0, 113, 227, 0.85)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 4,
                }}
              >
                推荐
              </div>
            )}
          </>
        ) : (
          <div onClick={onClick} style={{ color: '#d2d2d7', fontSize: 12, cursor: 'pointer' }}>
            <UploadOutlined style={{ fontSize: 22, display: 'block', marginBottom: 6 }} />
            <span style={{ fontSize: 11, color: '#aeaeb2' }}>点击上传</span>
          </div>
        )}
      </div>
    </div>
  )
}
