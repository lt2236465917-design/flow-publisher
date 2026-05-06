import { Button, Empty, Typography } from 'antd'
import type { ReactNode } from 'react'

const { Text } = Typography

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
}

export default function EmptyState({ icon, title, description, actionText, onAction }: EmptyStateProps) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center' }}>
      <Empty
        image={icon || Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <Text strong style={{ fontSize: 16 }}>{title}</Text>
            {description && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">{description}</Text>
              </div>
            )}
          </div>
        }
      >
        {actionText && onAction && (
          <Button type="primary" onClick={onAction}>{actionText}</Button>
        )}
      </Empty>
    </div>
  )
}
