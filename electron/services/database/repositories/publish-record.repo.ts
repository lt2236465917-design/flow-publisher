import type { Database } from 'sql.js'
import { v4 as uuidv4 } from 'uuid'

export interface PublishRecordRow {
  id: string
  account_id: string
  platform: string
  title: string
  description: string
  video_path: string
  cover_path: string | null
  hashtags: string
  declarations: string
  status: string
  progress: number
  publish_url: string | null
  error: string | null
  created_at: string
  updated_at: string
  content_id: string | null
  group_id: string | null
}

export class PublishRecordRepository {
  constructor(private db: Database) {}

  getAll(): PublishRecordRow[] {
    const stmt = this.db.prepare('SELECT * FROM publish_records ORDER BY created_at DESC')
    const rows: PublishRecordRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as PublishRecordRow)
    }
    stmt.free()
    return rows
  }

  getPaged(offset: number, limit: number): { rows: PublishRecordRow[]; total: number } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM publish_records')
    countStmt.step()
    const total = (countStmt.getAsObject() as { cnt: number }).cnt
    countStmt.free()

    const stmt = this.db.prepare('SELECT * FROM publish_records ORDER BY created_at DESC LIMIT ? OFFSET ?')
    stmt.bind([limit, offset])
    const rows: PublishRecordRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as PublishRecordRow)
    }
    stmt.free()
    return { rows, total }
  }

  getById(id: string): PublishRecordRow | null {
    const stmt = this.db.prepare('SELECT * FROM publish_records WHERE id = ?')
    stmt.bind([id])
    let row: PublishRecordRow | null = null
    if (stmt.step()) {
      row = stmt.getAsObject() as unknown as PublishRecordRow
    }
    stmt.free()
    return row
  }

  getByAccount(accountId: string): PublishRecordRow[] {
    const stmt = this.db.prepare('SELECT * FROM publish_records WHERE account_id = ? ORDER BY created_at DESC')
    stmt.bind([accountId])
    const rows: PublishRecordRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as PublishRecordRow)
    }
    stmt.free()
    return rows
  }

  create(data: {
    accountId: string
    platform: string
    title: string
    description: string
    videoPath: string
    coverPath?: string
    hashtags?: string[]
    declarations?: string[]
  }): PublishRecordRow {
    const id = uuidv4()
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO publish_records (id, account_id, platform, title, description, video_path, cover_path, hashtags, declarations, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.accountId,
        data.platform,
        data.title,
        data.description,
        data.videoPath,
        data.coverPath || null,
        JSON.stringify(data.hashtags || []),
        JSON.stringify(data.declarations || []),
        'pending',
        0,
        now,
        now
      ]
    )
    const row = this.getById(id)
    if (!row) throw new Error(`Failed to create publish record: INSERT succeeded but getById returned null`)
    return row
  }

  updateStatus(id: string, status: string, progress?: number, error?: string, publishUrl?: string): void {
    const now = new Date().toISOString()
    const sets: string[] = ['status = ?', 'updated_at = ?']
    const params: unknown[] = [status, now]

    if (progress !== undefined) {
      sets.push('progress = ?')
      params.push(progress)
    }
    if (error !== undefined) {
      sets.push('error = ?')
      params.push(error)
    }
    if (publishUrl !== undefined) {
      sets.push('publish_url = ?')
      params.push(publishUrl)
    }

    params.push(id)
    this.db.run(`UPDATE publish_records SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM publish_records WHERE id = ?', [id])
  }

  updateContentId(id: string, contentId: string): void {
    this.db.run('UPDATE publish_records SET content_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [contentId, id])
  }

  updateGroupId(id: string, groupId: string): void {
    this.db.run('UPDATE publish_records SET group_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [groupId, id])
  }

  /**
   * Store upload result metadata after successful upload.
   * Persists dimensions, md5, downloadUrl, etc. for recovery on crash (H7 fix)
   * and eliminates the need for mutable instance fields on adapters (H11 fix).
   */
  saveUploadMeta(id: string, meta: Record<string, unknown>): void {
    this.db.run('UPDATE publish_records SET upload_meta = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [JSON.stringify(meta), id])
  }

  /**
   * Retrieve upload metadata previously stored by saveUploadMeta.
   */
  getUploadMeta(id: string): Record<string, unknown> | null {
    const stmt = this.db.prepare('SELECT upload_meta FROM publish_records WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject() as { upload_meta: string | null }
      stmt.free()
      if (row.upload_meta) {
        try { return JSON.parse(row.upload_meta) } catch { return null }
      }
    }
    stmt.free()
    return null
  }
}
