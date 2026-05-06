import { Card, Tag, Typography } from 'antd'
import { PLATFORMS } from '@/constants/platforms'
import type { PlatformId } from '@/constants/platforms'

const { Text, Paragraph } = Typography

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
    <Card
      size="small"
      style={{ borderColor: info.color }}
      title={
        <span>
          {info.icon} {info.displayName} 预览
        </span>
      }
    >
      {coverUrl && (
        <div style={{ marginBottom: 12, textAlign: 'center' }}>
          <img
            src={coverUrl}
            alt="封面"
            style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 4, objectFit: 'cover' }}
          />
        </div>
      )}
      {title && (
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          {title}
        </Text>
      )}
      {description && (
        <Paragraph
          ellipsis={{ rows: 3 }}
          type="secondary"
          style={{ marginBottom: 8 }}
        >
          {description}
        </Paragraph>
      )}
      {hashtags.length > 0 && (
        <div>
          {hashtags.map((tag) => (
            <Tag key={tag} color={info.color}>
              #{tag}
            </Tag>
          ))}
        </div>
      )}
    </Card>
  )
}
