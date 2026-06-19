import { describe, expect, it } from 'vitest'
import { subscribeIpc } from './preload-listener'

describe('subscribeIpc', () => {
  it('removes the same wrapper that was registered', () => {
    let registered: ((...args: unknown[]) => void) | undefined
    let removed: ((...args: unknown[]) => void) | undefined

    const unsubscribe = subscribeIpc(
      (_channel, listener) => {
        registered = listener
      },
      (_channel, listener) => {
        removed = listener
      },
      'publish:progress',
      () => {}
    )

    unsubscribe()
    expect(removed).toBe(registered)
  })
})
