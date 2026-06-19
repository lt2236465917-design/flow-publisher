const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'a_bogus',
  'authorization',
  'api_ph',
  'csrf_token',
  'kuaishou.web.cp.api_ph',
  'mstoken',
  'sessionid',
  'sig',
  'signature',
  'token',
  'upload_token',
  'x-bogus',
  'x-secsdk-csrf-token'
])

export function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    url.searchParams.forEach((_value, key) => {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]')
      }
    })
    return url.toString()
  } catch {
    return '[invalid-url]'
  }
}

export function summarizePayload(
  value: unknown
): { keys: string[]; byteLength: number } {
  let serialized: string
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  } catch {
    serialized = String(value)
  }
  const keys =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).sort()
      : []
  return { keys, byteLength: Buffer.byteLength(serialized) }
}
