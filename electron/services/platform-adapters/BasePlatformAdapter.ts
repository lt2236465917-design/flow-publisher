import type { IPlatformAdapter } from './IPlatformAdapter'
import { logger } from '../../utils/logger'

/**
 * Base platform adapter with API-only mode.
 * Login is handled by ElectronLoginWindow (not Playwright).
 * Publishing is handled via API (HTTP requests, no browser automation).
 */
export abstract class BasePlatformAdapter implements IPlatformAdapter {
  abstract readonly platformId: string
  abstract readonly platformName: string
  abstract readonly loginUrl: string

  /**
   * Get account info via API (optional).
   * Used to get the real display name after login.
   */
  async getAccountInfoAPI?(client: import('../http/HttpClient').HttpClient): Promise<{ displayName?: string; avatarUrl?: string } | null>

  /**
   * Check if session is valid via API (optional).
   * If not implemented, the system assumes the session is valid if cookies exist.
   */
  async checkSessionAPI?(client: import('../http/HttpClient').HttpClient): Promise<boolean>
}
