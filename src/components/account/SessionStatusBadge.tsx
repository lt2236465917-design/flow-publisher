import type { SessionStatus } from '@/types/platform.types'

const STATUS_MAP: Record<SessionStatus, { color: string; text: string }> = {
  logged_in: { color: '#34c759', text: '已登录' },
  expired: { color: '#ff3b30', text: '已过期' },
  not_logged_in: { color: '#aeaeb2', text: '未登录' }
}

interface Props {
  status: SessionStatus
}

export default function SessionStatusBadge({ status }: Props) {
  const { color, text } = STATUS_MAP[status]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        fontWeight: 500,
        color,
        letterSpacing: '0.02em',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          boxShadow: status === 'logged_in' ? `0 0 6px ${color}40` : 'none',
        }}
      />
      {text}
    </span>
  )
}
