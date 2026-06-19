import { describe, expect, it } from 'vitest'
import { hasAuthenticationCookie, parseStoredCookiePayload } from './cookie-data'

describe('stored cookie compatibility', () => {
  it('parses current JSON cookie arrays', () => {
    const payload = JSON.stringify([{
      name: 'web_session',
      value: 'token',
      domain: '.xiaohongshu.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true
    }])

    expect(parseStoredCookiePayload(payload)).toEqual(JSON.parse(payload))
  })

  it('preserves legacy Cookie header strings', () => {
    expect(parseStoredCookiePayload('sessionid=abc; token=def')).toBe('sessionid=abc; token=def')
  })

  it('requires a real platform authentication cookie before session recovery', () => {
    expect(hasAuthenticationCookie('xiaohongshu', ['a1', 'web_session'])).toBe(true)
    expect(hasAuthenticationCookie('xiaohongshu', ['a1'])).toBe(false)
    expect(hasAuthenticationCookie('kuaishou', ['did', 'userId'])).toBe(true)
    expect(hasAuthenticationCookie('kuaishou', ['did'])).toBe(false)
  })
})
