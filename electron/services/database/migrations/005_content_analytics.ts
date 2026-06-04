import type { Database } from 'sql.js'

/**
 * Migration 005: 添加视频数据采集支持
 *
 * 1. 给 publish_records 添加 content_id 字段（平台端视频ID）
 * 2. 给 publish_records 添加 group_id 字段（视频分组ID）
 * 3. 创建 video_groups 表（关联同一视频的多平台发布）
 */
export function runMigration005(db: Database): void {
  // 检查 content_id 列是否已存在
  const columns = db.exec("PRAGMA table_info(publish_records)")
  const existingColumns = columns[0]?.values.map((row: any[]) => row[1] as string) || []

  // 添加 content_id 列
  if (!existingColumns.includes('content_id')) {
    db.run("ALTER TABLE publish_records ADD COLUMN content_id TEXT")
  }

  // 添加 group_id 列
  if (!existingColumns.includes('group_id')) {
    db.run("ALTER TABLE publish_records ADD COLUMN group_id TEXT")
  }

  // 创建 video_groups 表
  db.run(`
    CREATE TABLE IF NOT EXISTS video_groups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      video_path TEXT NOT NULL,
      cover_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}
