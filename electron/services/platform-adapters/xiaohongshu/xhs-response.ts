export type XhsSubmitResponse = {
  success?: boolean
  code?: number
  result?: number
  msg?: string
  data?: Record<string, unknown>
}

export function parseXhsSubmitPayload(raw: unknown): XhsSubmitResponse | null {
  let payload = raw
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown
    } catch {
      return null
    }
  }
  if (!payload || typeof payload !== 'object') return null
  return payload as XhsSubmitResponse
}

export function isXhsSubmitAccepted(data: XhsSubmitResponse | null): boolean {
  return !!data && (
    data.success === true ||
    data.result === 0 ||
    (data.code === 0 && data.success !== false)
  )
}

export function extractXhsNoteId(data: XhsSubmitResponse): string | undefined {
  const noteIdValue = data.data?.note_id || data.data?.noteId || data.data?.id
  if (typeof noteIdValue !== 'string' && typeof noteIdValue !== 'number') return undefined

  const noteId = String(noteIdValue).trim()
  return noteId || undefined
}

export function parseXhsSignature(
  signature: string
): { headers: Record<string, string>; a1?: string; cookie?: string } {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(signature) as Record<string, unknown>
  } catch {
    parsed = JSON.parse(signature.replace(/\\/g, '"')) as Record<string, unknown>
  }

  const entries = Object.entries(parsed)
  const getValue = (name: string): string | undefined => {
    const entry = entries.find(([key, value]) =>
      key.toLowerCase() === name.toLowerCase() &&
      (typeof value === 'string' || typeof value === 'number')
    )
    if (!entry) return undefined
    const value = String(entry[1]).trim()
    return value || undefined
  }

  const headers: Record<string, string> = {}
  const xs = getValue('x-s')
  const xt = getValue('x-t')
  const xsCommon = getValue('x-s-common')

  if (xs) headers['X-s'] = xs
  if (xt) headers['X-t'] = xt
  if (xsCommon) headers['X-S-Common'] = xsCommon

  for (const [name, rawValue] of entries) {
    const lowerName = name.toLowerCase()
    if (!lowerName.startsWith('x-')) continue
    if (lowerName === 'x-s' || lowerName === 'x-t' || lowerName === 'x-s-common') continue
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') continue
    const value = String(rawValue).trim()
    if (value) headers[name] = value
  }

  return {
    headers,
    a1: getValue('a1'),
    cookie: getValue('cookie')
  }
}

export function shouldUseXhsBrowserHttpTransport(headers: Record<string, string>): boolean {
  const normalized = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  )
  return Boolean(
    normalized.get('x-rap-param') &&
    !normalized.get('x-s-common')
  )
}

export function stripXhsSessionBoundHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'x-rap-param')
  )
}
