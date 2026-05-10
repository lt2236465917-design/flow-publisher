import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'

interface Props {
  platform: PlatformId
  title: string
  description: string
  coverUrl: string | null
  hashtags: string[]
}

export default function PublishPreviewCard({ platform, title, description, coverUrl, hashtags }: Props) {
  const info = PLATFORMS[platform]
  if (!info) return null

  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        border: '1px solid rgba(0, 0, 0, 0.06)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>{info.icon}</span>
        <span
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: '#1d1d1f',
          }}
        >
          {info.displayName} 预览
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: 16 }}>
        {coverUrl && (
          <div style={{ marginBottom: 12, textAlign: 'center' }}>
            <img
              src={coverUrl}
              alt="封面"
              style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 8, objectFit: 'cover' }}
            />
          </div>
        )}
        {title && (
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#1d1d1f',
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            {title}
          </div>
        )}
        {description && (
          <div
            style={{
              fontSize: 13,
              color: '#86868b',
              marginBottom: 8,
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description}
          </div>
        )}
        {hashtags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {hashtags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: info.color,
                  background: `${info.color}10`,
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
