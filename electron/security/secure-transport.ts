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
