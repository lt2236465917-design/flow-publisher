export function toLocalFileUrl(filePath?: string | null): string {
  if (!filePath) return ''

  const normalizedPath = filePath.replace(/\\/g, '/')
  const encodedPath = normalizedPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const pathPrefix = normalizedPath.startsWith('/') ? '' : '/'

  return `local-file://${pathPrefix}${encodedPath}`
}
