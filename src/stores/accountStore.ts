import { create } from 'zustand'
import type { AccountInfo } from '@/types/platform.types'
import { ipcInvoke } from '@/utils/ipc'
import { toChineseMessage } from '@/utils/errorMessages'

interface LoginProgress {
  platformId: string
  status: 'idle' | 'launching' | 'waiting_qr' | 'scanning' | 'verifying' | 'success' | 'error'
  qrDataUrl?: string
  error?: string
}

interface AccountState {
  accounts: AccountInfo[]
  loginProgress: Record<string, LoginProgress>
  loading: boolean

  fetchAccounts: () => Promise<void>
  startLogin: (platformId: string) => Promise<boolean>
  checkSession: (accountId: string) => Promise<void>
  logout: (accountId: string) => Promise<void>
  setQrDataUrl: (platformId: string, qrDataUrl: string) => void
  setLoginStatus: (platformId: string, status: LoginProgress['status'], error?: string) => void
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  loginProgress: {},
  loading: false,

  fetchAccounts: async () => {
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

    const response = await ipcInvoke<{ accountId: string; displayName?: string }>('account:login', platformId)

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
  },

  checkSession: async (accountId: string) => {
    const response = await ipcInvoke<{ sessionStatus: string }>('account:check-session', accountId)
    if (response.success) {
      await get().fetchAccounts()
    }
  },

  logout: async (accountId: string) => {
    const response = await ipcInvoke('account:logout', accountId)
    if (response.success) {
      await get().fetchAccounts()
    }
  },

  setQrDataUrl: (platformId, qrDataUrl) => {
    set((s) => ({
      loginProgress: {
        ...s.loginProgress,
        [platformId]: { ...s.loginProgress[platformId], platformId, qrDataUrl, status: 'waiting_qr' }
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
