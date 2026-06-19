import { getAccountRepository, saveDatabase } from '../database'
import { logger } from '../../utils/logger'
import { encryptString, decryptString } from '../../utils/crypto-store'
import { session } from 'electron'
import {
  hasAuthenticationCookie,
  parseStoredCookiePayload,
  type StoredCookieData as CookieData
} from './cookie-data'

export class CookieStore {
  async saveCookies(accountId: string, cookies: CookieData[]): Promise<void> {
    const repo = getAccountRepository()
    // Encrypt cookies before storing (M1 fix — safeStorage or base64 fallback)
    const encrypted = encryptString(JSON.stringify(cookies))
    repo.updateSession(accountId, 'logged_in', encrypted)
    saveDatabase()

    // Log cookie metadata only (never values)
    const domains = [...new Set(cookies.map(c => c.domain))]
    logger.info(`Cookies saved for account ${accountId}, count: ${cookies.length}`)
    logger.debug(`  domains: ${domains.join(', ')}`)  // demoted to debug — metadata only
  }

  async clearCookies(accountId: string): Promise<void> {
    const repo = getAccountRepository()
    repo.updateSession(accountId, 'not_logged_in', '[]')
    saveDatabase()
    logger.info(`Cookies cleared for account ${accountId}`)
  }

  /**
   * Export cookies as a string for HTTP API calls.
   * Returns the cookie string in "name=value; name2=value2" format.
   */
  getCookieString(accountId: string): string | null {
    const repo = getAccountRepository()
    const account = repo.getById(accountId)
    if (!account || !account.cookies || account.cookies === '[]') {
      logger.warn(`No cookies found for account ${accountId}`)
      return null
    }
    try {
      // Decrypt cookies before parsing (handles legacy plaintext transparently)
      const decrypted = decryptString(account.cookies)
      const parsed = parseStoredCookiePayload(decrypted)
      if (typeof parsed === 'string') {
        logger.info(`Using legacy cookie header for account ${accountId}, length: ${parsed.length}`)
        return parsed
      }
      const cookies = parsed
      if (cookies.length === 0) {
        logger.warn(`Empty cookies array for account ${accountId}`)
        return null
      }
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      logger.info(`Cookie string exported for account ${accountId}, length: ${cookieStr.length}`)
      return cookieStr
    } catch (err) {
      logger.error(`Failed to export cookie string for account ${accountId}:`, err)
      return null
    }
  }

  /**
   * Load cookies from the database, falling back to the account's persistent
   * Electron login session. The fallback repairs credentials that became
   * unreadable after a safeStorage/keychain change without requiring a new
   * login, but only when platform-specific authentication cookies are present.
   */
  async getCookieStringWithSessionFallback(accountId: string): Promise<string | null> {
    const stored = this.getCookieString(accountId)
    if (stored) return stored

    const repo = getAccountRepository()
    const account = repo.getById(accountId)
    if (!account) return null

    try {
      const ses = session.fromPartition(`persist:auth-${accountId}`)
      const cookies = await ses.cookies.get({})
      if (!hasAuthenticationCookie(account.platform, cookies.map((cookie) => cookie.name))) {
        logger.warn(`No authenticated Electron session cookies found for account ${accountId}`)
        return null
      }

      const normalized: CookieData[] = cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expirationDate || -1,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite === 'unspecified' ? undefined : cookie.sameSite
      }))

      const encrypted = encryptString(JSON.stringify(normalized))
      repo.updateSession(accountId, 'logged_in', encrypted)
      saveDatabase()

      const cookieStr = normalized.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
      logger.info(`Recovered cookies from Electron session for account ${accountId}, count: ${normalized.length}`)
      return cookieStr
    } catch (err) {
      logger.error(`Failed to recover Electron session cookies for account ${accountId}:`, err)
      return null
    }
  }
}
