import type { Database } from 'sql.js'

const PUBLISH_RECORDS_SQL = `
CREATE TABLE IF NOT EXISTS publish_records (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  video_path TEXT NOT NULL,
  cover_path TEXT,
  hashtags TEXT NOT NULL DEFAULT '[]',
  declarations TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  publish_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_publish_records_platform ON publish_records(platform);
CREATE INDEX IF NOT EXISTS idx_publish_records_status ON publish_records(status);
CREATE INDEX IF NOT EXISTS idx_publish_records_account ON publish_records(account_id);
`

export function runMigration002(db: Database): void {
  // Check if table already exists to make migration idempotent
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publish_records'")
  const exists = stmt.step()
  stmt.free()
  if (!exists) {
    db.run(PUBLISH_RECORDS_SQL)
  }
}
