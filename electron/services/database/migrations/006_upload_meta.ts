import type { Database } from 'sql.js'
import { logger } from '../../../utils/logger'

/**
 * Migration 006: Add upload_meta column to publish_records.
 *
 * Stores upload result metadata (dimensions, md5, downloadUrl, fileId, etc.)
 * so that submitContentAPI can read it from the database instead of relying
 * on mutable instance fields on the adapter singleton.
 *
 * Also fixes H7 (CDN orphan files on crash) — the upload metadata persists
 * across app restarts.
 */
export function runMigration006(db: Database): void {
  // Check if column already exists (migration idempotency)
  const cols = db.exec("PRAGMA table_info('publish_records')")
  if (cols.length > 0) {
    const columnNames = cols[0].values.map((row: any[]) => row[1])
    if (columnNames.includes('upload_meta')) {
      logger.info('[DB] Migration 006: upload_meta column already exists, skipping')
      return
    }
  }

  db.run(`ALTER TABLE publish_records ADD COLUMN upload_meta TEXT`)
  logger.info('[DB] Migration 006: Added upload_meta column to publish_records')
}
