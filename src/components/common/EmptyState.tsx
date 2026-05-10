import { Button } from 'antd'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  actionText?: string
  onAction?: () => void
}

export default function EmptyState({ icon, title, description, actionText, onAction }: EmptyStateProps) {
  return (
    <div
      style={{
        padding: '56px 0',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      {icon && (
        <div
          style={{
            fontSize: 48,
            color: '#d2d2d7',
            lineHeight: 1,
            marginBottom: 4,
          }}
        >
          {icon}
        </div>
      )}
      <div
        style={{
          fontFamily: "'Sora', sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: '#1d1d1f',
          letterSpacing: '-0.01em',
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            fontSize: 13,
            color: '#86868b',
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          {description}
        </div>
      )}
      {actionText && onAction && (
        <Button
          type="primary"
          onClick={onAction}
          style={{ marginTop: 8 }}
        >
          {actionText}
        </Button>
      )}
    </div>
  )
}
