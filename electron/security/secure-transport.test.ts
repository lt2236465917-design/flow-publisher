import { describe, expect, it } from 'vitest'
import {
  requireSecureOrLoopbackEndpoint,
  requireSecureUploadEndpoint
} from './secure-transport'

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

  it('rejects plaintext remote signer endpoints', () => {
    expect(() =>
      requireSecureOrLoopbackEndpoint('http://qianming.example.com/sign')
    ).toThrow('HTTPS')
  })

  it('allows plaintext only for loopback signer endpoints', () => {
    expect(
      requireSecureOrLoopbackEndpoint('http://127.0.0.1:17321/sign')
    ).toBe('http://127.0.0.1:17321/sign')
    expect(
      requireSecureOrLoopbackEndpoint('http://localhost:17321/sign')
    ).toBe('http://localhost:17321/sign')
  })
})
