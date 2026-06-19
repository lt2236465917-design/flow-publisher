export function requireSecureUploadEndpoint(value: string): string {
  const normalized = value.includes('://') ? value : `https://${value}`
  const url = new URL(normalized)
  if (url.protocol !== 'https:') {
    throw new Error('上传端点必须使用 HTTPS')
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error('上传端点无效')
  }
  return url.origin
}

export function requireSecureOrLoopbackEndpoint(value: string): string {
  const url = new URL(value)
  if (!url.hostname || url.username || url.password) {
    throw new Error('签名端点无效')
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const secure = url.protocol === 'https:'
  const localHttp =
    url.protocol === 'http:' && loopbackHosts.has(url.hostname.toLowerCase())
  if (!secure && !localHttp) {
    throw new Error('远程签名端点必须使用 HTTPS')
  }
  return url.toString()
}
