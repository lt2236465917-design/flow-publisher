import { describe, expect, it } from 'vitest'
import { isTrustedIpcSender } from './ipc-guard'

describe('IPC sender guard', () => {
  it('requires the top-level trusted renderer frame', () => {
    expect(
      isTrustedIpcSender({
        senderUrl: 'file:///app/out/renderer/index.html',
        topFrameUrl: 'file:///app/out/renderer/index.html',
        expectedWindowId: 7,
        senderWindowId: 7,
        rendererRoot: '/app/out/renderer'
      })
    ).toBe(true)
  })

  it('rejects iframe and navigated sender origins', () => {
    expect(
      isTrustedIpcSender({
        senderUrl: 'https://attacker.test/frame',
        topFrameUrl: 'file:///app/out/renderer/index.html',
        expectedWindowId: 7,
        senderWindowId: 7,
        rendererRoot: '/app/out/renderer'
      })
    ).toBe(false)
  })

  it('rejects a trusted URL sent from a different BrowserWindow', () => {
    expect(
      isTrustedIpcSender({
        senderUrl: 'file:///app/out/renderer/index.html',
        topFrameUrl: 'file:///app/out/renderer/index.html',
        expectedWindowId: 7,
        senderWindowId: 9,
        rendererRoot: '/app/out/renderer'
      })
    ).toBe(false)
  })
})
