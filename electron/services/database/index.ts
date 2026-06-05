import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync, writeFile, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { runMigration } from './migrations/001_accounts'
import { runMigration002 } from './migrations/002_publish_records'
import { runMigration003 } from './migrations/003_scheduled_tasks'
import { runMigration004 } from './migrations/004_analytics_snapshots'
import { runMigration005 } from './migrations/005_content_analytics'
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
    analyticsRepo: null
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

  runMigration(dbInstance)
  runMigration002(dbInstance)
  runMigration003(dbInstance)
  runMigration004(dbInstance)
  runMigration005(dbInstance)
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

// Async save manager: debounces rapid saveDatabase() calls into a single disk write
let saveDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveWriting = false

const SAVE_DEBOUNCE_MS = 300

function flushSave(): void {
  if (!saveDirty || saveWriting || !dbInstance) return
  saveDirty = false
  saveWriting = true

  const data = dbInstance.export()
  const buffer = Buffer.from(data)
  const dbPath = getDbPath()

  writeFile(dbPath, buffer, (err) => {
    saveWriting = false
    if (err) {
      logger.error('[DB] Async save failed:', err)
      // Re-mark dirty so the next call retries
      saveDirty = true
    }
    // If another save was requested while writing, flush again
    if (saveDirty) flushSave()
  })
}

/**
 * Schedule an async debounced save. Multiple calls within 300ms collapse into one write.
 * Fire-and-forget: callers do not need to await this.
 */
export function saveDatabase(): void {
  if (!dbInstance) return
  saveDirty = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    flushSave()
  }, SAVE_DEBOUNCE_MS)
}

/**
 * Synchronous save — blocks the main thread. Use only for shutdown / critical paths.
 */
export function saveDatabaseSync(): void {
  if (!dbInstance) return
  // Cancel any pending async save to avoid double-write
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveDirty = false
  saveWriting = false
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
