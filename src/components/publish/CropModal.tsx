import { useState, useCallback } from 'react'
import { Modal, Slider, Button, Space } from 'antd'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import type { Area } from 'react-easy-crop'

interface Props {
  visible: boolean
  imageSrc: string
  aspect: number
  title?: string
  onConfirm: (croppedImageUrl: string) => void
  onCancel: () => void
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.src = url
  })
}

async function getCroppedImg(imageSrc: string, pixelCrop: Area): Promise<string> {
  const image = await createImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  canvas.width = pixelCrop.width
  canvas.height = pixelCrop.height

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve('')
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    }, 'image/jpeg', 0.9)
  })
}

export default function CropModal({ visible, imageSrc, aspect, title, onConfirm, onCancel }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const handleConfirm = async () => {
    if (!croppedAreaPixels) return
    const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels)
    onConfirm(croppedImage)
  }

  return (
    <Modal
      title={title || '裁剪封面'}
      open={visible}
      onCancel={onCancel}
      width={600}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={handleConfirm}>确认裁剪</Button>
        </Space>
      }
    >
      <div style={{ position: 'relative', width: '100%', height: 360, background: '#1a1a1a', borderRadius: 8 }}>
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
      <div style={{ padding: '16px 0' }}>
        <span style={{ marginRight: 8, fontSize: 13, color: '#666' }}>缩放</span>
        <Slider
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={setZoom}
          style={{ width: '80%', display: 'inline-block' }}
        />
      </div>
    </Modal>
  )
}
