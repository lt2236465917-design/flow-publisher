import { message } from 'antd'
import type { IpcResponse } from '../../shared/contracts/ipc.contract'

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('timeout')
  }
  return false
}

function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return '未知错误'
}

/**
 * Unified IPC invoke wrapper with retry, error handling, and toast notifications.
 */
export async function ipcInvoke<T = unknown>(
  channel: string,
  ...args: unknown[]
): Promise<IpcResponse<T>> {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await window.electron.ipcRenderer.invoke<IpcResponse<T>>(channel, ...args)

      if (response.success) {
        return response
      }

      // Non-retryable business error
      if (response.error) {
        return response
      }

      return response
    } catch (err) {
      lastError = err

      // Only retry on network-like errors
      if (isNetworkError(err) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1))
        continue
      }

      break
    }
  }

  const errorMsg = getErrorMessage(lastError)
  return { success: false, error: errorMsg }
}

/**
 * IPC invoke that shows error toast on failure.
 */
export async function ipcInvokeWithToast<T = unknown>(
  channel: string,
  errorMsg: string,
  ...args: unknown[]
): Promise<IpcResponse<T>> {
  const res = await ipcInvoke<T>(channel, ...args)
  if (!res.success) {
    message.error(`${errorMsg}: ${res.error || '操作失败'}`)
  }
  return res
}

/**
 * Check if the IPC response indicates success.
 */
export function isSuccess<T>(res: IpcResponse<T>): res is IpcResponse<T> & { data: T } {
  return res.success && res.data !== undefined
}
