import { Tag } from 'antd'

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  pending: { color: 'default', label: '待执行' },
  running: { color: 'processing', label: '执行中' },
  done: { color: 'success', label: '已完成' },
  error: { color: 'error', label: '失败' },
  cancelled: { color: 'warning', label: '已取消' },
  uploading: { color: 'processing', label: '上传中' },
  uploaded: { color: 'blue', label: '已上传' },
  submitting: { color: 'processing', label: '提交中' }
}

export default function TaskStatusTag({ status }: { status: string }) {
  const info = STATUS_MAP[status] || { color: 'default', label: status }
  return <Tag color={info.color}>{info.label}</Tag>
}
