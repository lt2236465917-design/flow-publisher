import { useEffect } from 'react'
import { useAccountStore } from '@/stores/accountStore'

const STARTUP_DELAY_MS = 1_000
const FOREGROUND_RECHECK_INTERVAL_MS = 10 * 60 * 1_000
const ACTIVE_RECHECK_INTERVAL_MS = 30 * 60 * 1_000

let lastSuccessfulCheckAt = 0

/**
 * 静默维护账号登录状态：
 * - 应用启动后检查一次
 * - 应用保持前台时定期检查
 * - 从后台恢复、窗口重新聚焦或网络恢复时，状态过旧才检查
 */
export function useAutoCheckSessions() {
  const checkAllSessions = useAccountStore((state) => state.checkAllSessions)

  useEffect(() => {
    const runCheck = async (force = false) => {
      const now = Date.now()
      const isFresh = now - lastSuccessfulCheckAt < FOREGROUND_RECHECK_INTERVAL_MS

      if (!force && isFresh) {
        return
      }

      const success = await checkAllSessions()
      if (success) {
        lastSuccessfulCheckAt = Date.now()
      }
    }

    const startupTimer = window.setTimeout(() => {
      void runCheck()
    }, STARTUP_DELAY_MS)

    const activeTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void runCheck(true)
      }
    }, ACTIVE_RECHECK_INTERVAL_MS)

    const handleForeground = () => {
      if (document.visibilityState === 'visible') {
        void runCheck()
      }
    }

    const handleFocus = () => {
      void runCheck()
    }

    const handleOnline = () => {
      void runCheck()
    }

    document.addEventListener('visibilitychange', handleForeground)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)

    return () => {
      window.clearTimeout(startupTimer)
      window.clearInterval(activeTimer)
      document.removeEventListener('visibilitychange', handleForeground)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
    }
  }, [checkAllSessions])
}
