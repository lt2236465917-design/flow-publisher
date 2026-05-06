import type { Database } from 'sql.js'

const SCHEDULED_TASKS_SQL = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  platforms TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  video_path TEXT NOT NULL,
  cover_path TEXT,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '[]',
  declarations TEXT NOT NULL DEFAULT '[]',
  platform_overrides TEXT NOT NULL DEFAULT '{}',
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_scheduled_at ON scheduled_tasks(scheduled_at);
`

export function runMigration003(db: Database): void {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_tasks'")
  const exists = stmt.step()
  stmt.free()
  if (!exists) {
    db.run(SCHEDULED_TASKS_SQL)
  }
}
