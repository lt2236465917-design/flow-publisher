import { describe, expect, it } from 'vitest'
import { redactUrl, summarizePayload } from './log-redaction'

describe('log redaction', () => {
  it('redacts sensitive query values', () => {
    expect(
      redactUrl(
        'https://x.test/upload?upload_token=secret&access_token=abc&part=1'
      )
    ).toBe(
      'https://x.test/upload?upload_token=%5BREDACTED%5D&access_token=%5BREDACTED%5D&part=1'
    )
  })

  it('redacts platform-specific signing query values', () => {
    const result = redactUrl(
      'https://creator.douyin.com/api?msToken=secret&X-Bogus=signed&a_bogus=also-signed&page=1'
    )

    expect(result).not.toContain('secret')
    expect(result).not.toContain('signed')
    expect(result).toContain('page=1')
  })

  it('logs payload shape rather than content', () => {
    expect(summarizePayload({ caption: 'private text', token: 'secret' }))
      .toEqual({
        keys: ['caption', 'token'],
        byteLength: expect.any(Number)
      })
  })

  it('does not echo malformed URLs', () => {
    expect(redactUrl('not a url?token=secret')).toBe('[invalid-url]')
  })
})
