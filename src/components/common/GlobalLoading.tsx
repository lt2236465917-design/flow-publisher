import { Spin } from 'antd'
import { useUIStore } from '@/stores/uiStore'

export default function GlobalLoading() {
  const loadingTasks = useUIStore((s) => s.loadingTasks)

  if (loadingTasks.length === 0) return null

  const currentTask = loadingTasks[loadingTasks.length - 1]

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          paddingTop: 12,
          pointerEvents: 'auto'
        }}
      >
        <Spin tip={currentTask.message} size="small">
          <div style={{ width: 0, height: 0 }} />
        </Spin>
      </div>
    </div>
  )
}
