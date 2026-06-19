const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: 'rgba(142, 142, 147, 0.1)', color: '#8e8e93', label: '待执行' },
  running: { bg: 'rgba(0, 113, 227, 0.08)', color: '#0071e3', label: '执行中' },
  done: { bg: 'rgba(52, 199, 89, 0.08)', color: '#34c759', label: '已完成' },
  unconfirmed: { bg: 'rgba(255, 149, 0, 0.08)', color: '#ff9500', label: '待确认' },
  error: { bg: 'rgba(255, 59, 48, 0.08)', color: '#ff3b30', label: '失败' },
  cancelled: { bg: 'rgba(255, 149, 0, 0.08)', color: '#ff9500', label: '已取消' },
  uploading: { bg: 'rgba(0, 113, 227, 0.08)', color: '#0071e3', label: '上传中' },
  uploaded: { bg: 'rgba(90, 200, 250, 0.08)', color: '#5ac8fa', label: '已上传' },
  submitting: { bg: 'rgba(175, 82, 222, 0.08)', color: '#af52de', label: '提交中' }
}

export default function TaskStatusTag({ status }: { status: string }) {
  const info = STATUS_MAP[status] || { bg: 'rgba(142, 142, 147, 0.1)', color: '#8e8e93', label: status }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        fontWeight: 500,
        color: info.color,
        background: info.bg,
        padding: '3px 10px',
        borderRadius: 6,
        letterSpacing: '0.02em',
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: info.color,
          opacity: 0.8,
        }}
      />
      {info.label}
    </span>
  )
}
