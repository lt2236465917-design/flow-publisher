import { describe, expect, it } from 'vitest'

describe('Kuaishou analytics timestamp normalization', () => {
  it('normalizes millisecond publish times to seconds', () => {
    const milliseconds = 1_718_000_000_000
    const normalized = milliseconds > 10_000_000_000
      ? Math.floor(milliseconds / 1000)
      : milliseconds

    expect(normalized).toBe(1_718_000_000)
  })

  it('keeps second timestamps unchanged', () => {
    const seconds = 1_718_000_000
    const normalized = seconds > 10_000_000_000
      ? Math.floor(seconds / 1000)
      : seconds

    expect(normalized).toBe(seconds)
  })
})
