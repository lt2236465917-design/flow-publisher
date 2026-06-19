import { describe, expect, it } from 'vitest'
import {
  extractXhsNoteId,
  isXhsSubmitAccepted,
  parseXhsSignature,
  parseXhsSubmitPayload,
  shouldUseXhsBrowserHttpTransport,
  stripXhsSessionBoundHeaders
} from './xhs-response'

describe('Xiaohongshu submit response handling', () => {
  it('does not invent a note id for an HTTP 461-style empty success response', () => {
    const response = parseXhsSubmitPayload({ success: true, code: 0, data: {} })

    expect(isXhsSubmitAccepted(response)).toBe(true)
    expect(response && extractXhsNoteId(response)).toBeUndefined()
  })

  it('extracts a confirmed note id from supported response fields', () => {
    expect(extractXhsNoteId({ success: true, data: { note_id: 'note-123' } })).toBe('note-123')
    expect(extractXhsNoteId({ result: 0, data: { noteId: 456 } })).toBe('456')
  })

  it('does not accept an explicit failed response even when code is zero', () => {
    expect(isXhsSubmitAccepted({ success: false, code: 0 })).toBe(false)
  })
})

describe('Xiaohongshu submit transport selection', () => {
  it('keeps session-bound x-rap-param requests in the authenticated browser HTTP context', () => {
    expect(shouldUseXhsBrowserHttpTransport({
      'X-s': 'xs',
      'X-t': 'xt',
      'x-rap-param': 'session-bound'
    })).toBe(true)
  })

  it('allows direct HTTP when a complete X-S-Common signature is available', () => {
    expect(shouldUseXhsBrowserHttpTransport({
      'X-s': 'xs',
      'X-t': 'xt',
      'X-S-Common': 'portable-signature',
      'x-rap-param': 'also-present'
    })).toBe(false)
  })

  it('does not replay a probe-time x-rap-param during the real browser request', () => {
    expect(stripXhsSessionBoundHeaders({
      'X-s': 'xs',
      'X-t': 'xt',
      'x-rap-param': 'stale-session-value'
    })).toEqual({
      'X-s': 'xs',
      'X-t': 'xt'
    })
  })
})

describe('Xiaohongshu signature normalization', () => {
  it('preserves lowercase X-S-Common returned by a signer', () => {
    const result = parseXhsSignature(JSON.stringify({
      'x-s': 'xs-value',
      'x-t': 123456,
      'x-s-common': 'common-value',
      'x-rap-param': 'rap-value',
      Cookie: 'a1=session-cookie; web_session=abc',
      a1: 'a1-value'
    }))

    expect(result).toEqual({
      headers: {
        'X-s': 'xs-value',
        'X-t': '123456',
        'X-S-Common': 'common-value',
        'x-rap-param': 'rap-value'
      },
      a1: 'a1-value',
      cookie: 'a1=session-cookie; web_session=abc'
    })
  })

  it('parses the escaped signature format returned by newxiaohongshu signer', () => {
    const result = parseXhsSignature(
      '{\\X-s\\:\\xs-value\\,\\X-t\\:123456,\\a1\\:\\a1-value\\,\\X-S-Common\\:\\common-value\\}'
    )

    expect(result).toEqual({
      headers: {
        'X-s': 'xs-value',
        'X-t': '123456',
        'X-S-Common': 'common-value'
      },
      a1: 'a1-value',
      cookie: undefined
    })
  })
})
