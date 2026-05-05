import { create } from 'zustand'
import type { AccountInfo } from '@/types/platform.types'

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
    const response = await window.electron.ipcRenderer.invoke<AccountInfo[]>('account:list')
    if (response.success) {
      set({ accounts: response.data || [], loading: false })
    } else {
      set({ loading: false })
    }
  },

  startLogin: async (platformId: string) => {
    set((s) => ({
      loginProgress: { ...s.loginProgress, [platformId]: { platformId, status: 'launching' } }
    }))

    const response = await window.electron.ipcRenderer.invoke<{ accountId: string; displayName?: string }>('account:login', platformId)

    if (response.success) {
      set((s) => ({
        loginProgress: { ...s.loginProgress, [platformId]: { platformId, status: 'success' } }
      }))
      await get().fetchAccounts()
      return true
    } else {
      set((s) => ({
        loginProgress: {
          ...s.loginProgress,
          [platformId]: { platformId, status: 'error', error: response.error }
        }
      }))
      return false
    }
  },

  checkSession: async (accountId: string) => {
    const response = await window.electron.ipcRenderer.invoke<{ sessionStatus: string }>('account:check-session', accountId)
    if (response.success) {
      await get().fetchAccounts()
    }
  },

  logout: async (accountId: string) => {
    const response = await window.electron.ipcRenderer.invoke('account:logout', accountId)
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
