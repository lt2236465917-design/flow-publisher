import { Badge } from 'antd'
import type { SessionStatus } from '@/types/platform.types'

const STATUS_MAP: Record<SessionStatus, { status: 'success' | 'error' | 'default'; text: string }> = {
  logged_in: { status: 'success', text: '已登录' },
  expired: { status: 'error', text: '已过期' },
  not_logged_in: { status: 'default', text: '未登录' }
}

interface Props {
  status: SessionStatus
}

export default function SessionStatusBadge({ status }: Props) {
  const { status: badgeStatus, text } = STATUS_MAP[status]
  return <Badge status={badgeStatus} text={text} />
}
