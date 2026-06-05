import { getAccountRepository, saveDatabase } from '../database'
import { logger } from '../../utils/logger'
import { encryptString, decryptString } from '../../utils/crypto-store'

// Cookie格式（兼容Playwright和Electron）
interface CookieData {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

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
      const cookies: CookieData[] = JSON.parse(decrypted)
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
}
