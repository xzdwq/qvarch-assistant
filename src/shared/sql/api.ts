import type { DbConn } from './connection'
import type { DbSchema, SqlMode, SqlRunOut } from './result'
import type { SqlTemplate } from './templates'

/** «Базы данных» as the page calls it (window.qa.sql(method, …)). */
export interface SqlApi {
  conns(): DbConn[]
  save(c: DbConn): DbConn[]
  remove(id: string): DbConn[]
  run(runId: string, conn: string, sql: string, values: unknown[], mode: SqlMode): Promise<SqlRunOut>
  stop(runId: string): void
  library(): SqlTemplate[]
  /** The connection's tables and columns (kept a few minutes; `fresh` — read again). */
  schema(conn: string, fresh?: boolean): Promise<DbSchema | { error: string }>
}
export const SQL_METHODS = ['conns', 'save', 'remove', 'run', 'stop', 'library', 'schema'] as const
