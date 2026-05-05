import type { BrowserContext, Cookie } from 'playwright-core'
import { getAccountRepository, saveDatabase } from '../database'
import { logger } from '../../utils/logger'

export class CookieStore {
  async saveCookies(accountId: string, context: BrowserContext): Promise<void> {
    const cookies = await context.cookies()
    const repo = getAccountRepository()
    repo.updateSession(accountId, 'logged_in', JSON.stringify(cookies))
    saveDatabase()
    logger.info(`Cookies saved for account ${accountId}, count: ${cookies.length}`)
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
}
