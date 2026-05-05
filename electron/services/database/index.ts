import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { runMigration } from './migrations/001_accounts'
import { runMigration002 } from './migrations/002_publish_records'
import { AccountRepository } from './repositories/account.repo'
import { PublishRecordRepository } from './repositories/publish-record.repo'
import { logger } from '../../utils/logger'

const DB_FILENAME = 'videosync.db'

let dbInstance: Database | null = null
let accountRepoInstance: AccountRepository | null = null
let publishRecordRepoInstance: PublishRecordRepository | null = null

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
  saveDatabase()

  accountRepoInstance = new AccountRepository(dbInstance)
  publishRecordRepoInstance = new PublishRecordRepository(dbInstance)
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

export function saveDatabase(): void {
  if (!dbInstance) return
  const data = dbInstance.export()
  writeFileSync(getDbPath(), Buffer.from(data))
}

export function closeDatabase(): void {
  if (dbInstance) {
    saveDatabase()
    dbInstance.close()
    dbInstance = null
    accountRepoInstance = null
    publishRecordRepoInstance = null
    logger.info('Database closed')
  }
}
