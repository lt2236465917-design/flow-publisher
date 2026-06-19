import { describe, expect, it } from 'vitest'
import { requireSecureUploadEndpoint } from './secure-transport'

describe('secure transport', () => {
  it('rejects plaintext remote upload endpoints', () => {
    expect(() =>
      requireSecureUploadEndpoint('http://upload.kuaishouzt.com')
    ).toThrow('HTTPS')
  })

  it('normalizes host-only upload endpoints to HTTPS', () => {
    expect(requireSecureUploadEndpoint('upload.kuaishouzt.com')).toBe(
      'https://upload.kuaishouzt.com'
    )
  })

  it('accepts HTTPS upload endpoints', () => {
    expect(
      requireSecureUploadEndpoint('https://upload.kuaishouzt.com')
    ).toBe('https://upload.kuaishouzt.com')
  })
})
