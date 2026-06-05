import type { Database } from 'sql.js'
import { v4 as uuidv4 } from 'uuid'

export interface AccountRow {
  id: string
  platform: string
  display_name: string
  avatar_url: string | null
  cookies: string
  session_status: string
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export class AccountRepository {
  constructor(private db: Database) {}

  getAll(): AccountRow[] {
    const stmt = this.db.prepare('SELECT * FROM accounts ORDER BY created_at DESC')
    const rows: AccountRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as AccountRow)
    }
    stmt.free()
    return rows
  }

  getById(id: string): AccountRow | null {
    const stmt = this.db.prepare('SELECT * FROM accounts WHERE id = ?')
    stmt.bind([id])
    let row: AccountRow | null = null
    if (stmt.step()) {
      row = stmt.getAsObject() as unknown as AccountRow
    }
    stmt.free()
    return row
  }

  getByPlatform(platform: string): AccountRow[] {
    const stmt = this.db.prepare('SELECT * FROM accounts WHERE platform = ? ORDER BY created_at DESC')
    stmt.bind([platform])
    const rows: AccountRow[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as AccountRow)
    }
    stmt.free()
    return rows
  }

  create(data: { platform: string; displayName: string; cookies?: string }): AccountRow {
    const id = uuidv4()
    const now = new Date().toISOString()
    this.db.run(
      'INSERT INTO accounts (id, platform, display_name, cookies, session_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, data.platform, data.displayName, data.cookies ?? '[]', 'not_logged_in', now, now]
    )
    const row = this.getById(id)
    if (!row) throw new Error(`Failed to create account: INSERT succeeded but getById returned null`)
    return row
  }

  updateSession(id: string, status: string, cookies?: string, displayName?: string): void {
    const now = new Date().toISOString()
    const sets: string[] = ['session_status = ?', 'updated_at = ?']
    const params: unknown[] = [status, now]

    if (cookies !== undefined) {
      sets.splice(1, 0, 'cookies = ?')
      params.splice(1, 0, cookies)
    }
    if (displayName !== undefined) {
      sets.splice(1, 0, 'display_name = ?')
      params.splice(1, 0, displayName)
    }
    if (status === 'logged_in') {
      sets.push('last_login_at = ?')
      params.push(now)
    }

    params.push(id)
    this.db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  deleteById(id: string): void {
    this.db.run('DELETE FROM accounts WHERE id = ?', [id])
  }
}
