import { safeStorage } from 'electron'
import { logger } from './logger'

/**
 * Encrypt a string using Electron's safeStorage API (OS-level encryption).
 * On platforms where safeStorage is unavailable (e.g. Linux without keychain),
 * falls back to base64 obfuscation with a warning.
 *
 * Encrypted data is prefixed with "enc:" so readers can distinguish encrypted
 * from legacy plaintext cookies.
 */
export function encryptString(plaintext: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintext)
    return 'enc:' + encrypted.toString('base64')
  }
  // Fallback: base64 obfuscation (NOT encryption — logged as a warning)
  logger.warn('[crypto-store] safeStorage not available — cookies stored as plaintext base64')
  return 'b64:' + Buffer.from(plaintext, 'utf-8').toString('base64')
}

/**
 * Decrypt a string previously encrypted with encryptString().
 * Handles both encrypted ('enc:') and legacy plaintext/obfuscated ('b64:') formats.
 */
export function decryptString(stored: string): string {
  if (stored.startsWith('enc:')) {
    const buf = Buffer.from(stored.slice(4), 'base64')
    return safeStorage.decryptString(buf)
  }
  if (stored.startsWith('b64:')) {
    return Buffer.from(stored.slice(4), 'base64').toString('utf-8')
  }
  // Legacy: plaintext cookies stored before encryption was added
  return stored
}
