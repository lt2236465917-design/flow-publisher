// Shared IPC contract types used by both main and renderer processes
// Will be populated in Phase 2+

export interface IpcRequest<T = unknown> {
  channel: string
  payload?: T
}

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
