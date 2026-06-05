import { useEffect, useRef } from 'react'
import { useAccountStore } from '@/stores/accountStore'

/**
 * 应用启动时自动检查所有已登录账号的会话状态
 * 只在首次加载时执行一次
 */
export function useAutoCheckSessions() {
  const { checkAllSessions, checkingSessions } = useAccountStore()
  const hasChecked = useRef(false)

  useEffect(() => {
    console.log('[useAutoCheckSessions] Hook mounted, hasChecked:', hasChecked.current, 'checkingSessions:', checkingSessions)

    // 只检查一次，避免重复检查
    if (hasChecked.current || checkingSessions) {
      console.log('[useAutoCheckSessions] Skipping - already checked or checking')
      return
    }

    hasChecked.current = true

    // 延迟 1 秒执行，让应用先完成初始化
    const timer = setTimeout(() => {
      console.log('[useAutoCheckSessions] Starting session check...')
      checkAllSessions()
    }, 1000)

    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
