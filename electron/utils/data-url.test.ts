import { describe, expect, it } from 'vitest'
import { parseImageDataUrl } from './data-url'

describe('parseImageDataUrl', () => {
  it('rejects unsupported image MIME types', () => {
    expect(() =>
      parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=', 50)
    ).toThrow('不支持的图片格式')
  })

  it('rejects decoded data larger than the limit', () => {
    const data = Buffer.alloc(51).toString('base64')
    expect(() =>
      parseImageDataUrl(`data:image/png;base64,${data}`, 50)
    ).toThrow('图片文件过大')
  })

  it('returns normalized extension and decoded bytes', () => {
    const data = Buffer.from('image-data').toString('base64')
    const result = parseImageDataUrl(`data:image/jpeg;base64,${data}`, 50)

    expect(result.extension).toBe('jpg')
    expect(result.buffer.toString()).toBe('image-data')
  })
})
