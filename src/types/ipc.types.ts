// IPC type contracts between main and renderer processes
// Will be populated in Phase 2+

export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
