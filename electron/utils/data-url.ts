const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/gif': 'gif'
}

export function parseImageDataUrl(
  value: string,
  maxBytes = 50 * 1024 * 1024
): { buffer: Buffer; extension: string; mime: string } {
  if (typeof value !== 'string') {
    throw new Error('无效的 data URL 格式')
  }

  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!match || !MIME_EXTENSIONS[match[1]]) {
    throw new Error('不支持的图片格式')
  }

  const base64 = match[2].replace(/\s/g, '')
  const estimatedBytes = Math.floor((base64.length * 3) / 4)
  if (estimatedBytes > maxBytes + 2) {
    throw new Error('图片文件过大（最大50MB）')
  }

  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length > maxBytes) {
    throw new Error('图片文件过大（最大50MB）')
  }

  return {
    buffer,
    extension: MIME_EXTENSIONS[match[1]],
    mime: match[1]
  }
}
