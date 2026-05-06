import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { runMigration } from './migrations/001_accounts'
import { runMigration002 } from './migrations/002_publish_records'
import { runMigration003 } from './migrations/003_scheduled_tasks'
import { runMigration004 } from './migrations/004_analytics_snapshots'
import { AccountRepository } from './repositories/account.repo'
import { PublishRecordRepository } from './repositories/publish-record.repo'
import { ScheduledTaskRepository } from './repositories/scheduled-task.repo'
import { AnalyticsRepository } from './repositories/analytics.repo'
import { logger } from '../../utils/logger'

const DB_FILENAME = 'videosync.db'
const BACKUP_DIR = 'db-backups'
const MAX_BACKUPS = 5

let dbInstance: Database | null = null
let accountRepoInstance: AccountRepository | null = null
let publishRecordRepoInstance: PublishRecordRepository | null = null
let scheduledTaskRepoInstance: ScheduledTaskRepository | null = null
let analyticsRepoInstance: AnalyticsRepository | null = null

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

  runMigration(dbInstance)
  runMigration002(dbInstance)
  runMigration003(dbInstance)
  runMigration004(dbInstance)
  saveDatabase()

  accountRepoInstance = new AccountRepository(dbInstance)
  publishRecordRepoInstance = new PublishRecordRepository(dbInstance)
  scheduledTaskRepoInstance = new ScheduledTaskRepository(dbInstance)
  analyticsRepoInstance = new AnalyticsRepository(dbInstance)
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

export function saveDatabase(): void {
  if (!dbInstance) return
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
    saveDatabase()
    dbInstance.close()
    dbInstance = null
    accountRepoInstance = null
    publishRecordRepoInstance = null
    scheduledTaskRepoInstance = null
    analyticsRepoInstance = null
    logger.info('Database closed')
  }
}
