import type { Database } from 'sql.js'
import { logger } from '../../../utils/logger'

export function runMigration008(db: Database): void {
  const columns = db.exec("PRAGMA table_info('publish_records')")
  const names = columns[0]?.values.map((row) => String(row[1])) || []
  if (!names.includes('source_task_id')) {
    db.run('ALTER TABLE publish_records ADD COLUMN source_task_id TEXT')
  }

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_records_source_task_platform
    ON publish_records(source_task_id, platform)
    WHERE source_task_id IS NOT NULL
  `)
  logger.info('[DB] Migration 008: scheduled publish source index ready')
}
