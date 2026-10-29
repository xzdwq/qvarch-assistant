import type { DbConn } from './connection'
import type { DbSchema, SqlMode, SqlRunOut } from './result'
import type { ErSchema } from './er'
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
  /** The structure for an ER diagram — read on demand in a process of its own (`runId` — stopped by `stop`); kept a few minutes. */
  er(runId: string, conn: string, fresh?: boolean): Promise<ErSchema | { error: string }>
}
export const SQL_METHODS = ['conns', 'save', 'remove', 'run', 'stop', 'library', 'schema', 'er'] as const
