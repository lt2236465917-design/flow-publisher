import { isTrustedMainRendererUrl } from './navigation-policy'

export interface IpcSenderDescriptor {
  senderUrl: string
  topFrameUrl: string
  expectedWindowId: number
  senderWindowId: number | null
  devRendererUrl?: string
  rendererRoot?: string
}

export function isTrustedIpcSender(input: IpcSenderDescriptor): boolean {
  return (
    input.senderWindowId === input.expectedWindowId &&
    input.senderUrl === input.topFrameUrl &&
    isTrustedMainRendererUrl(
      input.senderUrl,
      input.devRendererUrl,
      input.rendererRoot
    )
  )
}
