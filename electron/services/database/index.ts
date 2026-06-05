import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync, writeFile, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { runMigration } from './migrations/001_accounts'
import { runMigration002 } from './migrations/002_publish_records'
import { runMigration003 } from './migrations/003_scheduled_tasks'
import { runMigration004 } from './migrations/004_analytics_snapshots'
import { runMigration005 } from './migrations/005_content_analytics'
import { runMigration006 } from './migrations/006_upload_meta'
import { runMigration007 } from './migrations/007_progress_tracking'
import { AccountRepository } from './repositories/account.repo'
import { PublishRecordRepository } from './repositories/publish-record.repo'
import { ScheduledTaskRepository } from './repositories/scheduled-task.repo'
import { AnalyticsRepository } from './repositories/analytics.repo'
import { logger } from '../../utils/logger'

const DB_FILENAME = 'videosync.db'
const BACKUP_DIR = 'db-backups'
const MAX_BACKUPS = 5

// Use global to persist across HMR reloads in development
const globalDb = globalThis as any
if (!globalDb.__dbInstances) {
  globalDb.__dbInstances = {
    db: null,
    accountRepo: null,
    publishRecordRepo: null,
    scheduledTaskRepo: null,
    analyticsRepo: null,
    // Async-save state must survive HMR reloads too —
    // otherwise pending writes are silently lost on hot reload
    saveDirty: false,
    saveTimer: null,
    saveWriting: false
  }
}

let dbInstance: Database | null = globalDb.__dbInstances.db
let accountRepoInstance: AccountRepository | null = globalDb.__dbInstances.accountRepo
let publishRecordRepoInstance: PublishRecordRepository | null = globalDb.__dbInstances.publishRecordRepo
let scheduledTaskRepoInstance: ScheduledTaskRepository | null = globalDb.__dbInstances.scheduledTaskRepo
let analyticsRepoInstance: AnalyticsRepository | null = globalDb.__dbInstances.analyticsRepo

function getDbPath(): string {
  const { app } = require('electron')
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, DB_FILENAME)
}

function locateWasm(): string {
  const candidates = [
    join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
    join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('sql.js WASM binary not found')
}

export async function initDatabase(): Promise<void> {
  if (dbInstance) return

  const wasmPath = locateWasm()
  const wasmBinary = readFileSync(wasmPath)

  const SQL = await initSqlJs({ wasmBinary })
  const dbPath = getDbPath()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    dbInstance = new SQL.Database(buffer)
    logger.info('Database loaded from', dbPath)
  } else {
    dbInstance = new SQL.Database()
    logger.info('Database created, will save to', dbPath)
  }

  // Enable foreign key enforcement (SQLite has it OFF by default)
  dbInstance.run('PRAGMA foreign_keys = ON')

  // Migration version tracking — ensures each migration runs exactly once (M5 fix)
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const appliedVersions = new Set<number>()
  const migStmt = dbInstance.prepare('SELECT version FROM _migrations')
  while (migStmt.step()) {
    appliedVersions.add((migStmt.getAsObject() as { version: number }).version)
  }
  migStmt.free()

  const migrations: Array<{ version: number; name: string; run: () => void }> = [
    { version: 1, name: '001_accounts', run: () => runMigration(dbInstance) },
    { version: 2, name: '002_publish_records', run: () => runMigration002(dbInstance) },
    { version: 3, name: '003_scheduled_tasks', run: () => runMigration003(dbInstance) },
    { version: 4, name: '004_analytics_snapshots', run: () => runMigration004(dbInstance) },
    { version: 5, name: '005_content_analytics', run: () => runMigration005(dbInstance) },
    { version: 6, name: '006_upload_meta', run: () => runMigration006(dbInstance) },
    { version: 7, name: '007_progress_tracking', run: () => runMigration007(dbInstance) },
  ]

  for (const mig of migrations) {
    if (appliedVersions.has(mig.version)) {
      logger.info(`[DB] Migration ${mig.name} already applied, skipping`)
      continue
    }
    try {
      logger.info(`[DB] Applying migration ${mig.name}...`)
      mig.run()
      dbInstance.run('INSERT INTO _migrations (version, name) VALUES (?, ?)', [mig.version, mig.name])
      logger.info(`[DB] Migration ${mig.name} applied successfully`)
    } catch (err) {
      logger.error(`[DB] Migration ${mig.name} FAILED:`, err)
      throw new Error(`Database migration ${mig.name} (v${mig.version}) failed: ${err}`)
    }
  }

  saveDatabaseSync() // Sync: must complete before app continues

  accountRepoInstance = new AccountRepository(dbInstance)
  publishRecordRepoInstance = new PublishRecordRepository(dbInstance)
  scheduledTaskRepoInstance = new ScheduledTaskRepository(dbInstance)
  analyticsRepoInstance = new AnalyticsRepository(dbInstance)

  // Persist to global for HMR resilience
  globalDb.__dbInstances = {
    db: dbInstance,
    accountRepo: accountRepoInstance,
    publishRecordRepo: publishRecordRepoInstance,
    scheduledTaskRepo: scheduledTaskRepoInstance,
    analyticsRepo: analyticsRepoInstance
  }

  logger.info('Database initialized')
}

export function getDatabase(): Database {
  if (!dbInstance) throw new Error('Database not initialized')
  return dbInstance
}

export function getAccountRepository(): AccountRepository {
  if (!accountRepoInstance) throw new Error('Database not initialized')
  return accountRepoInstance
}

export function getPublishRecordRepository(): PublishRecordRepository {
  if (!publishRecordRepoInstance) throw new Error('Database not initialized')
  return publishRecordRepoInstance
}

export function getScheduledTaskRepository(): ScheduledTaskRepository {
  if (!scheduledTaskRepoInstance) throw new Error('Database not initialized')
  return scheduledTaskRepoInstance
}

export function getAnalyticsRepository(): AnalyticsRepository {
  if (!analyticsRepoInstance) throw new Error('Database not initialized')
  return analyticsRepoInstance
}

// Async save manager: debounces rapid saveDatabase() calls into a single disk write.
// State is stored on globalThis so pending writes survive HMR reloads.
function saveState() { return globalDb.__dbInstances }
const SAVE_DEBOUNCE_MS = 300

function flushSave(): void {
  const state = saveState()
  if (!state.saveDirty || state.saveWriting || !dbInstance) return
  state.saveDirty = false
  state.saveWriting = true

  const data = dbInstance.export()
  const buffer = Buffer.from(data)
  const dbPath = getDbPath()

  writeFile(dbPath, buffer, (err) => {
    state.saveWriting = false
    if (err) {
      logger.error('[DB] Async save failed:', err)
      // Re-mark dirty so the next call retries
      state.saveDirty = true
    }
    // If another save was requested while writing, flush again
    if (state.saveDirty) flushSave()
  })
}

/**
 * Schedule an async debounced save. Multiple calls within 300ms collapse into one write.
 * Fire-and-forget: callers do not need to await this.
 */
export function saveDatabase(): void {
  if (!dbInstance) return
  const state = saveState()
  state.saveDirty = true
  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null
    flushSave()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Synchronous save — blocks the main thread. Use only for shutdown / critical paths.
 */
export function saveDatabaseSync(): void {
  if (!dbInstance) return
  // Cancel any pending async save to avoid double-write
  const state = saveState()
  if (state.saveTimer) {
    clearTimeout(state.saveTimer)
    state.saveTimer = null
  }
  state.saveDirty = false
  state.saveWriting = false
  const data = dbInstance.export()
  writeFileSync(getDbPath(), Buffer.from(data))
}

/**
 * Create a timestamped backup of the database file.
 * Keeps only the most recent MAX_BACKUPS backups.
 */
export function backupDatabase(): void {
  try {
    const dbPath = getDbPath()
    if (!existsSync(dbPath)) return

    const dir = require('electron').app.getPath('userData')
    const backupDir = join(dir, BACKUP_DIR)
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(backupDir, `videosync-${timestamp}.db`)
    writeFileSync(backupPath, readFileSync(dbPath))

    // Prune old backups
    const files = readdirSync(backupDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ name: f, path: join(backupDir, f), time: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time)

    while (files.length > MAX_BACKUPS) {
      const old = files.pop()!
      unlinkSync(old.path)
      logger.info('Pruned old backup:', old.name)
    }

    logger.info('Database backed up to', backupPath)
  } catch (err) {
    logger.error('Database backup failed:', err)
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    try {
      saveDatabaseSync() // Sync: must complete before closing db handle
      dbInstance.close()
    } catch (err) {
      logger.error('Error closing database:', err)
    } finally {
      dbInstance = null
      accountRepoInstance = null
      publishRecordRepoInstance = null
      scheduledTaskRepoInstance = null
      analyticsRepoInstance = null

      // Clear global instances
      globalDb.__dbInstances = {
        db: null,
        accountRepo: null,
        publishRecordRepo: null,
        scheduledTaskRepo: null,
        analyticsRepo: null
      }

      logger.info('Database closed')
    }
  }
}
