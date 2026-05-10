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
        left: 72,
        right: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {/* Thin progress bar at top */}
      <div
        style={{
          height: 2,
          background: 'linear-gradient(90deg, transparent, #0071e3, transparent)',
          animation: 'flow-loading-slide 1.5s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes flow-loading-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
