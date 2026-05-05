import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // IPC methods will be added in Phase 2+
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
