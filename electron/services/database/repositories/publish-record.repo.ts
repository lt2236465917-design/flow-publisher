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
    return this.getById(id)!
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
}
