import { create } from 'zustand'
import { message, Modal } from 'antd'
import { toChineseMessage } from '@/utils/errorMessages'

interface LoadingTask {
  id: string
  message: string
}

interface UIState {
  loadingTasks: LoadingTask[]
  networkOnline: boolean

  // Loading
  showLoading: (id: string, message?: string) => void
  hideLoading: (id: string) => void
  isLoading: (id?: string) => boolean

  // Network
  setNetworkOnline: (online: boolean) => void

  // Notifications
  showError: (error: unknown, prefix?: string) => void
  showSuccess: (msg: string) => void
  showWarning: (msg: string) => void
  showInfo: (msg: string) => void

  // Confirm dialog
  confirm: (options: {
    title: string
    content: string
    okText?: string
    cancelText?: string
    danger?: boolean
  }) => Promise<boolean>
}

export const useUIStore = create<UIState>((set, get) => ({
  loadingTasks: [],
  networkOnline: navigator.onLine,

  showLoading: (id, msg) => {
    set((s) => {
      const exists = s.loadingTasks.find((t) => t.id === id)
      if (exists) return s
      return { loadingTasks: [...s.loadingTasks, { id, message: msg || '加载中...' }] }
    })
  },

  hideLoading: (id) => {
    set((s) => ({ loadingTasks: s.loadingTasks.filter((t) => t.id !== id) }))
  },

  isLoading: (id) => {
    const tasks = get().loadingTasks
    return id ? tasks.some((t) => t.id === id) : tasks.length > 0
  },

  setNetworkOnline: (online) => {
    set({ networkOnline: online })
    if (!online) {
      message.warning('网络连接已断开')
    } else {
      message.success('网络连接已恢复')
    }
  },

  showError: (error, prefix) => {
    const msg = toChineseMessage(error)
    message.error(prefix ? `${prefix}: ${msg}` : msg)
  },

  showSuccess: (msg) => message.success(msg),
  showWarning: (msg) => message.warning(msg),
  showInfo: (msg) => message.info(msg),

  confirm: (options) => {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: options.title,
        content: options.content,
        okText: options.okText || '确认',
        cancelText: options.cancelText || '取消',
        okButtonProps: options.danger ? { danger: true } : undefined,
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
  }
}))

// Network status listener (register once)
let networkListenerRegistered = false
export function registerNetworkListener(): void {
  if (networkListenerRegistered) return
  networkListenerRegistered = true

  const store = useUIStore.getState()
  window.addEventListener('online', () => store.setNetworkOnline(true))
  window.addEventListener('offline', () => store.setNetworkOnline(false))
}
