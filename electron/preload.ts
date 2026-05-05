import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Account methods exposed to renderer
  account: {
    list: () => ipcRenderer.invoke('account:list'),
    login: (platformId: string) => ipcRenderer.invoke('account:login', platformId),
    checkSession: (accountId: string) => ipcRenderer.invoke('account:check-session', accountId),
    logout: (accountId: string) => ipcRenderer.invoke('account:logout', accountId)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, listener: (...args: unknown[]) => void) => {
          ipcRenderer.on(channel, (_event, ...args) => listener(...args))
          return () => ipcRenderer.removeListener(channel, listener)
        },
        once: (channel: string, listener: (...args: unknown[]) => void) => {
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
