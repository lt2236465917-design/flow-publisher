import { describe, expect, it } from 'vitest'
import {
  isAllowedPlatformNavigation,
  isSecureRemoteUrl,
  isTrustedMainRendererUrl
} from './navigation-policy'

describe('navigation policy', () => {
  it('accepts only the configured dev renderer origin', () => {
    expect(
      isTrustedMainRendererUrl(
        'http://localhost:5173/publish',
        'http://localhost:5173'
      )
    ).toBe(true)
    expect(
      isTrustedMainRendererUrl(
        'http://localhost.attacker.test:5173',
        'http://localhost:5173'
      )
    ).toBe(false)
  })

  it('accepts packaged renderer files only under the renderer root', () => {
    expect(
      isTrustedMainRendererUrl(
        'file:///app/out/renderer/index.html',
        undefined,
        '/app/out/renderer'
      )
    ).toBe(true)
    expect(
      isTrustedMainRendererUrl(
        'file:///Users/test/.ssh/id_rsa',
        undefined,
        '/app/out/renderer'
      )
    ).toBe(false)
  })

  it('allows platform navigation only to HTTPS host suffixes', () => {
    expect(
      isAllowedPlatformNavigation(
        'https://creator.douyin.com/creator-micro',
        ['douyin.com']
      )
    ).toBe(true)
    expect(
      isAllowedPlatformNavigation(
        'https://douyin.com.attacker.test/',
        ['douyin.com']
      )
    ).toBe(false)
    expect(
      isAllowedPlatformNavigation('http://creator.douyin.com/', ['douyin.com'])
    ).toBe(false)
  })

  it('allows HTTP only for loopback signer endpoints', () => {
    expect(isSecureRemoteUrl('https://upload.example.com/a')).toBe(true)
    expect(
      isSecureRemoteUrl('http://127.0.0.1:17321/sign', {
        allowLoopbackHttp: true
      })
    ).toBe(true)
    expect(isSecureRemoteUrl('http://upload.example.com/a')).toBe(false)
  })
})
