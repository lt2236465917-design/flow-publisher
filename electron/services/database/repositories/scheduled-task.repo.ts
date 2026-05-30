import type { Database } from 'sql.js'
import { v4 as uuidv4 } from 'uuid'

export interface ScheduledTaskRow {
  id: string
  platforms: string
  account_ids: string
  video_path: string
  cover_path: string | null
  title: string
  description: string
  hashtags: string
  declarations: string
  platform_overrides: string
  scheduled_at: string
  status: string
  retry_count: number
  max_retries: number
  error: string | null
  created_at: string
  updated_at: string
}

export class ScheduledTaskRepository {
  constructor(private db: Database) {}

  getAll(): ScheduledTaskRow[] {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY scheduled_at DESC')
    const rows: ScheduledTaskRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as ScheduledTaskRow)
    }
    stmt.free()
    return rows
  }

  getPendingTasks(): ScheduledTaskRow[] {
    const stmt = this.db.prepare(
      "SELECT * FROM scheduled_tasks WHERE status = 'pending' ORDER BY scheduled_at ASC"
    )
    const rows: ScheduledTaskRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as ScheduledTaskRow)
    }
    stmt.free()
    return rows
  }

  getById(id: string): ScheduledTaskRow | null {
    const stmt = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
    stmt.bind([id])
    let row: ScheduledTaskRow | null = null
    if (stmt.step()) {
      row = stmt.getAsObject() as unknown as ScheduledTaskRow
    }
    stmt.free()
    return row
  }

  getDueTasks(): ScheduledTaskRow[] {
    // Use datetime('now') to get current UTC time and compare with stored ISO timestamps
    // The stored scheduled_at is in ISO format (e.g., "2026-05-30T10:00:00.000Z")
    // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" format
    // We need to normalize the comparison
    const stmt = this.db.prepare(
      `SELECT * FROM scheduled_tasks
       WHERE status = 'pending'
       AND datetime(scheduled_at) <= datetime('now')
       ORDER BY scheduled_at ASC`
    )
    const rows: ScheduledTaskRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as ScheduledTaskRow)
    }
    stmt.free()
    return rows
  }

  create(data: {
    platforms: string[]
    accountIds: Record<string, string>
    videoPath: string
    coverPath?: string
    title: string
    description: string
    hashtags?: string[]
    declarations?: string[]
    platformOverrides?: Record<string, Record<string, unknown>>
    scheduledAt: string
  }): ScheduledTaskRow {
    const id = uuidv4()
    const now = new Date().toISOString()
    this.db.run(
      `INSERT INTO scheduled_tasks (id, platforms, account_ids, video_path, cover_path, title, description, hashtags, declarations, platform_overrides, scheduled_at, status, retry_count, max_retries, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        JSON.stringify(data.platforms),
        JSON.stringify(data.accountIds),
        data.videoPath,
        data.coverPath || null,
        data.title,
        data.description,
        JSON.stringify(data.hashtags || []),
        JSON.stringify(data.declarations || []),
        JSON.stringify(data.platformOverrides || {}),
        data.scheduledAt,
        'pending',
        0,
        3,
        now,
        now
      ]
    )
    return this.getById(id)!
  }

  updateStatus(id: string, status: string, error?: string): void {
    const now = new Date().toISOString()
    const sets: string[] = ['status = ?', 'updated_at = ?']
    const params: unknown[] = [status, now]

    if (error !== undefined) {
      sets.push('error = ?')
      params.push(error)
    }

    params.push(id)
    this.db.run(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  incrementRetry(id: string): void {
    const now = new Date().toISOString()
    this.db.run(
      'UPDATE scheduled_tasks SET retry_count = retry_count + 1, updated_at = ? WHERE id = ?',
      [now, id]
    )
  }

  cancelTask(id: string): void {
    const now = new Date().toISOString()
    this.db.run(
      "UPDATE scheduled_tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'",
      [now, id]
    )
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM scheduled_tasks WHERE id = ?', [id])
  }
}
