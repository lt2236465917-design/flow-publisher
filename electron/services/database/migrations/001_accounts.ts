import type { Database } from 'sql.js'
import { SCHEMA_SQL } from '../schema'

export function runMigration(db: Database): void {
  db.run(SCHEMA_SQL)
}
