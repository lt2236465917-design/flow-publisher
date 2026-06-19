import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { isTrustedIpcSender } from './ipc-guard'

interface MainRendererSecurityContext {
  window: BrowserWindow
  devRendererUrl?: string
  rendererRoot: string
}

let context: MainRendererSecurityContext | null = null

export function setMainRendererSecurityContext(
  window: BrowserWindow,
  devRendererUrl?: string
): void {
  context = {
    window,
    devRendererUrl,
    rendererRoot: join(__dirname, '../renderer')
  }
}

export function getMainWindow(): BrowserWindow | null {
  return context?.window && !context.window.isDestroyed() ? context.window : null
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const current = context
  if (!current) {
    throw new Error('主应用窗口尚未就绪')
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  const senderFrame = event.senderFrame
  if (!senderFrame) {
    throw new Error('拒绝无法识别来源页面的 IPC 请求')
  }
  const topFrame = senderFrame.top
  if (!topFrame) {
    throw new Error('拒绝无法识别顶层页面的 IPC 请求')
  }
  const trusted = isTrustedIpcSender({
    senderUrl: senderFrame.url,
    topFrameUrl: topFrame.url,
    expectedWindowId: current.window.id,
    senderWindowId: senderWindow?.id ?? null,
    devRendererUrl: current.devRendererUrl,
    rendererRoot: current.rendererRoot
  })

  if (!trusted) {
    throw new Error('拒绝来自非主应用页面的 IPC 请求')
  }
}

export function registerTrustedIpcHandler<Args extends unknown[], Result>(
  channel: string,
  listener: (
    event: IpcMainInvokeEvent,
    ...args: Args
  ) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event)
    return listener(event, ...(args as Args))
  })
}
