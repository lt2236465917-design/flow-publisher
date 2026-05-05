/// <reference types="vite/client" />

interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

interface ElectronIpcRenderer {
  send: (channel: string, ...args: unknown[]) => void
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<IpcResponse<T>>
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  once: (channel: string, listener: (...args: unknown[]) => void) => void
}

interface ApiAccount {
  list: () => Promise<unknown>
  login: (platformId: string) => Promise<unknown>
  checkSession: (accountId: string) => Promise<unknown>
  logout: (accountId: string) => Promise<unknown>
}

interface ApiPublish {
  probeVideo: (filePath: string) => Promise<unknown>
  extractFrames: (filePath: string, count?: number) => Promise<unknown>
  validateVideo: (filePath: string, platformId: string) => Promise<unknown>
  upload: (params: { accountId: string; platformId: string; filePath: string }) => Promise<unknown>
  submit: (params: { recordId: string; platformId: string; content: Record<string, unknown> }) => Promise<unknown>
  listRecords: () => Promise<unknown>
}

interface ApiFile {
  selectVideo: () => Promise<unknown>
  selectImage: () => Promise<unknown>
}

interface Window {
  electron: {
    ipcRenderer: ElectronIpcRenderer
  }
  api: {
    account: ApiAccount
    publish: ApiPublish
    file: ApiFile
    getPathForFile: (file: File) => string
  }
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
