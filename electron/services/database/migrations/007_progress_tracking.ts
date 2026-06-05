import type { Database } from 'sql.js'
import { logger } from '../../../utils/logger'

/**
 * Migration 007: Add progress tracking columns to publish_records.
 *
 * Allows the renderer to recover publish progress state after window close/reopen (M15 fix).
 */
export function runMigration007(db: Database): void {
  const cols = db.exec("PRAGMA table_info('publish_records')")
  if (cols.length > 0) {
    const columnNames = cols[0].values.map((row: any[]) => row[1])
    if (columnNames.includes('progress')) {
      logger.info('[DB] Migration 007: progress column already exists, skipping')
      return
    }
  }

  db.run(`ALTER TABLE publish_records ADD COLUMN progress INTEGER DEFAULT 0`)
  db.run(`ALTER TABLE publish_records ADD COLUMN progress_stage TEXT DEFAULT ''`)
  logger.info('[DB] Migration 007: Added progress tracking columns to publish_records')
}
