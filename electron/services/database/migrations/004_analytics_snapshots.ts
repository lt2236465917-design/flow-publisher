import type { Database } from 'sql.js'

const ANALYTICS_SNAPSHOTS_SQL = `
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  followers INTEGER NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (record_id) REFERENCES publish_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_record ON analytics_snapshots(record_id);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_platform ON analytics_snapshots(platform);
CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_date ON analytics_snapshots(snapshot_at);
`

export function runMigration004(db: Database): void {
  const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_snapshots'")
  const exists = stmt.step()
  stmt.free()
  if (!exists) {
    db.run(ANALYTICS_SNAPSHOTS_SQL)
  }
}
