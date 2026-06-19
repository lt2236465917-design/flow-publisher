import type { CSSProperties } from 'react'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'

interface Props {
  platformId: PlatformId
  size?: number
  radius?: number
  style?: CSSProperties
}

export default function PlatformIcon({
  platformId,
  size = 16,
  radius = Math.max(3, Math.round(size * 0.24)),
  style,
}: Props) {
  const platform = PLATFORMS[platformId]

  return (
    <span
      title={platform.displayName}
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: radius,
        background: platformId === 'douyin' ? '#000' : 'transparent',
        ...style,
      }}
    >
      <img
        src={platform.iconUrl}
        alt={platform.displayName}
        draggable={false}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </span>
  )
}
