export interface StoredCookieData {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export function parseStoredCookiePayload(payload: string): StoredCookieData[] | string {
  try {
    const parsed = JSON.parse(payload)
    if (!Array.isArray(parsed)) {
      throw new Error('cookie JSON must be an array')
    }
    return parsed as StoredCookieData[]
  } catch (err) {
    if (payload.includes('=')) {
      return payload
    }
    throw err
  }
}

export function hasAuthenticationCookie(platform: string, cookieNames: string[]): boolean {
  const required: Record<string, string[]> = {
    douyin: ['sessionid', 'sessionid_ss', 'sid_guard', 'sid_tt'],
    xiaohongshu: ['web_session', 'galaxy_creator_session_id'],
    kuaishou: ['userId', 'kuaishou.web.cp.api_st'],
    'wechat-channels': ['bizuin', 'slave_sid', 'wxsess_ticket', 'sessionid']
  }
  const names = new Set(cookieNames)
  return (required[platform] || []).some((name) => names.has(name))
}
