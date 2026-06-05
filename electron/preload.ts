import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Allowlist of IPC channels the renderer may invoke or listen to.
const ALLOWED_INVOKE_CHANNELS = new Set([
  'account:list', 'account:login', 'account:check-session', 'account:check-all-sessions', 'account:logout',
  'publish:probe-video', 'publish:extract-frames', 'publish:validate-video', 'publish:upload', 'publish:submit',
  'publish:list-records', 'publish:get-platform-fields', 'publish:get-mode', 'publish:set-mode',
  'publish:search-location', 'publish:get-ip-location', 'publish:get-recommend-locations', 'publish:get-collections',
  'schedule:create', 'schedule:list', 'schedule:cancel', 'schedule:delete',
  'analytics:fetch', 'analytics:compare', 'analytics:collect', 'analytics:collect-all',
  'analytics:collect-group', 'analytics:video-groups', 'analytics:video-detail', 'analytics:record-trend',
  'file:select-video', 'file:select-image', 'file:read-data-url', 'file:data-url-to-temp',
  'app:get-version'
])

const ALLOWED_LISTENER_CHANNELS = new Set([
  'account:qr-code',
  'publish:progress',
  'schedule:progress'
])

const api = {
  // Account methods exposed to renderer
  account: {
    list: () => ipcRenderer.invoke('account:list'),
    login: (platformId: string) => ipcRenderer.invoke('account:login', platformId),
    checkSession: (accountId: string) => ipcRenderer.invoke('account:check-session', accountId),
    logout: (accountId: string) => ipcRenderer.invoke('account:logout', accountId)
  },
  // Publish methods
  publish: {
    probeVideo: (filePath: string) => ipcRenderer.invoke('publish:probe-video', filePath),
    extractFrames: (filePath: string, count?: number) => ipcRenderer.invoke('publish:extract-frames', filePath, count),
    validateVideo: (filePath: string, platformId: string) => ipcRenderer.invoke('publish:validate-video', filePath, platformId),
    upload: (params: { accountId: string; platformId: string; filePath: string }) => ipcRenderer.invoke('publish:upload', params),
    submit: (params: { recordId: string; platformId: string; content: Record<string, unknown> }) => ipcRenderer.invoke('publish:submit', params),
    listRecords: () => ipcRenderer.invoke('publish:list-records')
  },
  // Schedule methods
  schedule: {
    create: (params: Record<string, unknown>) => ipcRenderer.invoke('schedule:create', params),
    list: () => ipcRenderer.invoke('schedule:list'),
    cancel: (taskId: string) => ipcRenderer.invoke('schedule:cancel', taskId),
    delete: (taskId: string) => ipcRenderer.invoke('schedule:delete', taskId)
  },
  // File dialog methods
  file: {
    selectVideo: () => ipcRenderer.invoke('file:select-video'),
    selectImage: () => ipcRenderer.invoke('file:select-image')
  },
  // Utility: get absolute file path from a File object (for drag-drop)
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => {
          if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
            return Promise.reject(new Error(`[preload] Blocked invoke on unauthorized channel: ${channel}`))
          }
          return ipcRenderer.invoke(channel, ...args)
        },
        on: (channel: string, listener: (...args: unknown[]) => void) => {
          if (!ALLOWED_LISTENER_CHANNELS.has(channel)) {
            console.error(`[preload] Blocked listener on unauthorized channel: ${channel}`)
            return () => {} // no-op unsubscribe
          }
          ipcRenderer.on(channel, (_event, ...args) => listener(...args))
          return () => { ipcRenderer.removeListener(channel, listener) }
        },
        once: (channel: string, listener: (...args: unknown[]) => void) => {
          if (!ALLOWED_LISTENER_CHANNELS.has(channel)) {
            console.error(`[preload] Blocked once-listener on unauthorized channel: ${channel}`)
            return
          }
          ipcRenderer.once(channel, (_event, ...args) => listener(...args))
        }
      }
    })
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore fallback for non-isolated context
  window.electron = { ipcRenderer }
  // @ts-ignore
  window.api = api
}
