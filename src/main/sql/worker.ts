import { readSchema, runSql, SqlError, type SqlMode } from './engine'
import type { DbConn } from '../../shared/sql'

/**
 * One database query, in a process of its own (made for it, gone after it): a driver that hangs never holds the app;
 * «Стоп» first asks it to cancel the query on the server and close its connection, then the process is killed.
 * (Its answer sent, the app ends it.)
 */
interface Job {
  conn: DbConn
  sql: string
  values: unknown[]
  mode: SqlMode
  /** The tables and columns read instead (for completion). */
  schema?: boolean
}
const port = process.parentPort
const ac = new AbortController()
let started = false
port.on('message', (e: { data: Job | { type: 'stop' } }) => {
  const m = e.data
  if ('type' in m) {
    ac.abort()
    return
  }
  if (started) return
  started = true
  const work = m.schema ? readSchema(m.conn, ac.signal).then((schema) => ({ schema })) : runSql(m.conn, m.sql, m.values, m.mode, ac.signal)
  void work.then(
    (run) => port.postMessage({ ok: true, run }),
    (err: unknown) => port.postMessage({ ok: false, error: err instanceof SqlError ? err.message : err instanceof Error ? err.message : String(err) }),
  )
})
