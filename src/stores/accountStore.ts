import { create } from 'zustand'
import type { AccountInfo } from '@/types/platform.types'
import { ipcInvoke } from '@/utils/ipc'
import { toChineseMessage } from '@/utils/errorMessages'
import { IPC_CHANNELS } from '@/constants/ipc-channels'

interface LoginProgress {
  platformId: string
  status: 'idle' | 'launching' | 'waiting_qr' | 'scanning' | 'verifying' | 'success' | 'error'
  qrDataUrl?: string
  fallbackMessage?: string
  error?: string
}

interface SessionCheckResult {
  accountId: string
  platform: string
  sessionStatus: string
}

interface AccountState {
  accounts: AccountInfo[]
  loginProgress: Record<string, LoginProgress>
  loading: boolean
  checkingSessions: boolean

  fetchAccounts: () => Promise<void>
  startLogin: (platformId: string) => Promise<boolean>
  checkSession: (accountId: string) => Promise<void>
  checkAllSessions: () => Promise<void>
  logout: (accountId: string) => Promise<void>
  setQrDataUrl: (platformId: string, qrDataUrl: string | null, fallbackMessage?: string) => void
  setLoginStatus: (platformId: string, status: LoginProgress['status'], error?: string) => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  loginProgress: {},
  loading: false,
  checkingSessions: false,

  fetchAccounts: async () => {
    // Prevent concurrent calls — multiple components may trigger this simultaneously
    if (get().loading) return
    set({ loading: true })
    try {
      const response = await ipcInvoke<AccountInfo[]>('account:list')
      if (response.success) {
        set({ accounts: response.data || [] })
      }
    } catch (err) {
      console.error('[accountStore] fetchAccounts error:', err)
    } finally {
      set({ loading: false })
    }
  },

  startLogin: async (platformId: string) => {
    set((s) => ({
      loginProgress: { ...s.loginProgress, [platformId]: { platformId, status: 'launching' } }
    }))

    try {
      const response = await ipcInvoke<{ accountId: string; displayName?: string }>(IPC_CHANNELS.ACCOUNT_LOGIN, platformId)

      if (response.success) {
        set((s) => ({
          loginProgress: { ...s.loginProgress, [platformId]: { platformId, status: 'success' } }
        }))
        await get().fetchAccounts()
        return true
      } else {
        const errorMsg = toChineseMessage(response.error)
        set((s) => ({
          loginProgress: {
            ...s.loginProgress,
            [platformId]: { platformId, status: 'error', error: errorMsg }
          }
        }))
        return false
      }
    } catch (err) {
      const errorMsg = toChineseMessage(err)
      set((s) => ({
        loginProgress: {
          ...s.loginProgress,
          [platformId]: { platformId, status: 'error', error: errorMsg }
        }
      }))
      return false
    }
  },

  checkSession: async (accountId: string) => {
    const response = await ipcInvoke<{ sessionStatus: string }>('account:check-session', accountId)
    if (response.success) {
      await get().fetchAccounts()
    }
  },

  checkAllSessions: async () => {
    if (get().checkingSessions) {
      console.log('[accountStore] checkAllSessions: already checking, skipping')
      return
    }

    console.log('[accountStore] checkAllSessions: starting...')
    set({ checkingSessions: true })
    try {
      const response = await ipcInvoke<SessionCheckResult[]>(IPC_CHANNELS.ACCOUNT_CHECK_ALL_SESSIONS)
      console.log('[accountStore] checkAllSessions response:', response)

      if (response.success) {
        // 刷新账号列表以获取最新状态
        await get().fetchAccounts()

        // 统计结果
        const results = response.data || []
        const expiredCount = results.filter(r => r.sessionStatus === 'expired').length
        const validCount = results.filter(r => r.sessionStatus === 'logged_in').length

        console.log(`[accountStore] Session check complete: ${validCount} valid, ${expiredCount} expired`)
      }
    } catch (err) {
      console.error('[accountStore] checkAllSessions error:', err)
    } finally {
      set({ checkingSessions: false })
    }
  },

  logout: async (accountId: string) => {
    const response = await ipcInvoke('account:logout', accountId)
    if (response.success) {
      await get().fetchAccounts()
    }
  },

  setQrDataUrl: (platformId, qrDataUrl, fallbackMessage) => {
    set((s) => ({
      loginProgress: {
        ...s.loginProgress,
        [platformId]: {
          ...s.loginProgress[platformId],
          platformId,
          qrDataUrl: qrDataUrl || undefined,
          fallbackMessage,
          status: 'waiting_qr'
        }
      }
    }))
  },

  setLoginStatus: (platformId, status, error) => {
    set((s) => ({
      loginProgress: {
        ...s.loginProgress,
        [platformId]: { ...s.loginProgress[platformId], platformId, status, error }
      }
    }))
  }
}))
