import type { BrowserContext, Cookie } from 'playwright-core'
import { getAccountRepository, saveDatabase } from '../database'
import { logger } from '../../utils/logger'

export class CookieStore {
  async saveCookies(accountId: string, context: BrowserContext): Promise<void> {
    const cookies = await context.cookies()
    const repo = getAccountRepository()
    repo.updateSession(accountId, 'logged_in', JSON.stringify(cookies))
    saveDatabase()

    // Log cookie details for debugging
    const domains = [...new Set(cookies.map(c => c.domain))]
    const cookieNames = cookies.map(c => c.name)
    logger.info(`Cookies saved for account ${accountId}, count: ${cookies.length}`)
    logger.info(`  domains: ${domains.join(', ')}`)
    logger.info(`  names: ${cookieNames.join(', ')}`)
  }

  async loadCookies(context: BrowserContext, accountId: string): Promise<boolean> {
    const repo = getAccountRepository()
    const account = repo.getById(accountId)
    if (!account || !account.cookies || account.cookies === '[]') {
      return false
    }
    try {
      const cookies: Cookie[] = JSON.parse(account.cookies)
      if (cookies.length === 0) return false
      await context.addCookies(cookies)
      logger.info(`Cookies loaded for account ${accountId}, count: ${cookies.length}`)
      return true
    } catch (err) {
      logger.error(`Failed to load cookies for account ${accountId}:`, err)
      return false
    }
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
      const cookies: Cookie[] = JSON.parse(account.cookies)
      if (cookies.length === 0) {
        logger.warn(`Empty cookies array for account ${accountId}`)
        return null
      }
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const domains = [...new Set(cookies.map(c => c.domain))]
      logger.info(`Cookie string exported for account ${accountId}, length: ${cookieStr.length}, domains: ${domains.join(', ')}`)
      return cookieStr
    } catch (err) {
      logger.error(`Failed to export cookie string for account ${accountId}:`, err)
      return null
    }
  }
}
