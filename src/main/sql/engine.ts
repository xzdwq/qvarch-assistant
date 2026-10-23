/**
 * A query sent to a database the safe way, one connection for it alone: connected (in 10 s, or not), the session set
 * read-only with its limits (the query's time, a lock waited for at most a few seconds, an abandoned transaction
 * ended by the server itself), the query in a read-only transaction, its rows read up to the limit (the rest not
 * fetched), rolled back, disconnected — whatever happened. Stopped (the signal): the query cancelled on the server
 * (not only the socket dropped — a server would go on), then the connection closed.
 */
import pg from 'pg'
import Cursor from 'pg-cursor'
import mysql from 'mysql2'
import { DB_DEFAULTS, guardSql, plainValue, sqlErrorText, type DbConn, type DbKind, type DbSchema, type SqlColumn, type SqlMode, type SqlRun, type SslMode } from '../../shared/sql'
import { mysqlAnalyzePlan, mysqlJsonPlan, pgPlan, sqlitePlan } from '../../shared/sqlPlan'

export type { SqlMode, SqlRun }
export class SqlError extends Error {}
/** A cell's text cut (a 10-MB document in each of a thousand rows would hold the app). */
const MAX_CELL = 200_000
const cell = (v: unknown) => {
  const p = plainValue(v)
  return typeof p === 'string' && p.length > MAX_CELL ? `${p.slice(0, MAX_CELL)}… (${p.length} симв.)` : p
}
const limits = (c: DbConn) => ({ timeoutSec: c.timeoutSec ?? DB_DEFAULTS.timeoutSec, lockSec: c.lockSec ?? DB_DEFAULTS.lockSec, maxRows: Math.max(1, Math.min(c.maxRows ?? DB_DEFAULTS.maxRows, 100_000)) })
/** A promise given up after `ms` (a close that would hang). */
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new Error('timeout')), ms))])
/** The drivers' TLS options of a connection's mode (none — no TLS). */
const TLS_OPTIONS: Record<SslMode, { rejectUnauthorized: boolean } | undefined> = { off: undefined, verify: { rejectUnauthorized: true }, 'no-verify': { rejectUnauthorized: false } }
const tlsOf = (c: DbConn) => (c.ssl ? TLS_OPTIONS[c.ssl] : undefined)

type Limits = ReturnType<typeof limits>
/** How each database runs a query. */
const RUNNERS: Record<DbKind, (c: DbConn, text: string, values: unknown[], mode: SqlMode, lim: Limits, signal?: AbortSignal) => Promise<SqlRun>> = {
  pg: runPg,
  mysql: runMysql,
  sqlite: runSqlite,
}

/** The query run (or explained) — refused before sending when it is not a reading one. */
export async function runSql(c: DbConn, sql: string, values: unknown[], mode: SqlMode, signal?: AbortSignal): Promise<SqlRun> {
  const g = guardSql(sql, c.kind)
  if (!g.ok) throw new SqlError(g.why)
  const text = sql.trim().replace(/;\s*$/, '')
  const lim = limits(c)
  try {
    return await RUNNERS[c.kind](c, text, values, mode, lim, signal)
  } catch (e) {
    if (e instanceof SqlError) throw e
    if (signal?.aborted) throw new SqlError('Запрос остановлен — на сервере снят, соединение закрыто')
    throw new SqlError(sqlErrorText(c.kind, e as { code?: string }, lim))
  }
}

// ---------- the schema: tables and columns, for completion ----------
const SCHEMA_SQL: Record<DbConn['kind'], string> = {
  pg: "select table_schema, table_name, column_name, data_type from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema') and table_schema not like 'pg\\_toast%' order by table_schema, table_name, ordinal_position",
  mysql: 'select table_schema, table_name, column_name, column_type from information_schema.columns where table_schema = coalesce(database(), table_schema) and table_schema not in (\'mysql\', \'sys\', \'information_schema\', \'performance_schema\') order by table_schema, table_name, ordinal_position',
  sqlite: "select null, m.name, p.name, p.type from sqlite_master m join pragma_table_info(m.name) p where m.type in ('table', 'view') and m.name not like 'sqlite\\_%' escape '\\' order by m.name, p.cid",
}
/** The schema a bare table name is in: PostgreSQL's «public», MySQL's database; SQLite has none. */
const DEFAULT_SCHEMA: Record<DbKind, (c: DbConn) => string | undefined> = { pg: () => 'public', mysql: (c) => c.database || undefined, sqlite: () => undefined }
/** The tables and their columns the connection's user can see — read the same safe way as any query. */
export async function readSchema(c: DbConn, signal?: AbortSignal): Promise<DbSchema> {
  const big = { ...c, maxRows: 100_000 }
  const r = (await runSql(big, SCHEMA_SQL[c.kind], [], 'run', signal)).result!
  const by = new Map<string, DbSchema['tables'][number]>()
  for (const [schema, table, column, type] of r.rows as Array<[string | null, string, string, string | null]>) {
    const k = `${schema ?? ''}.${table}`
    const t = by.get(k) ?? { ...(schema ? { schema } : {}), name: table, columns: [] }
    t.columns.push({ name: column, ...(type ? { type } : {}) })
    by.set(k, t)
  }
  const def = DEFAULT_SCHEMA[c.kind](c)
  return { defaultSchema: def, tables: [...by.values()], at: Date.now() }
}

// ---------- PostgreSQL ----------
// a bigint (count(*), ids) as a number when it fits one exactly, else as its text (the process is the query's own)
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => (Number.isSafeInteger(Number(v)) ? Number(v) : v))
// dates and times as the server wrote them (made into a JS Date they shift by the time zone: 2024-01-01 → …T21:00Z)
for (const t of [pg.types.builtins.DATE, pg.types.builtins.TIMESTAMP, pg.types.builtins.TIMESTAMPTZ, pg.types.builtins.TIME, pg.types.builtins.TIMETZ]) pg.types.setTypeParser(t, (v: string) => v)
const PG_TYPES = Object.fromEntries(Object.entries(pg.types.builtins).map(([k, v]) => [v, k.toLowerCase()])) as Record<number, string>
const pgConfig = (c: DbConn, lim: ReturnType<typeof limits>): pg.ClientConfig => ({
  host: c.host,
  port: c.port ?? 5432,
  database: c.database,
  user: c.user,
  password: c.password,
  ssl: tlsOf(c),
  connectionTimeoutMillis: DB_DEFAULTS.connectSec * 1000,
  application_name: 'qvarch',
  // the server's own limits: the query's time; a lock waited for a few seconds only (a query queued behind another
  // session's ALTER would hold every one after it); a transaction left open (the app gone) ended by the server
  statement_timeout: lim.timeoutSec * 1000,
  lock_timeout: lim.lockSec * 1000,
  idle_in_transaction_session_timeout: 15_000,
  // (the client's own: the server not answering at all)
  query_timeout: (lim.timeoutSec + 10) * 1000,
  keepAlive: true,
  options: '-c default_transaction_read_only=on',
})
async function runPg(c: DbConn, text: string, values: unknown[], mode: SqlMode, lim: ReturnType<typeof limits>, signal?: AbortSignal): Promise<SqlRun> {
  const client = new pg.Client(pgConfig(c, lim))
  let pid: number | undefined
  // stopped: the query cancelled from a second connection (the same user may cancel its own), then this one dropped
  const stop = async () => {
    if (pid) {
      const k = new pg.Client({ ...pgConfig(c, lim), statement_timeout: 5000, query_timeout: 7000 })
      await within(
        k.connect().then(() => k.query('select pg_cancel_backend($1)', [pid])),
        8000,
      ).catch(() => undefined)
      await within(k.end(), 3000).catch(() => undefined)
    }
    ;(client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy()
  }
  const onAbort = () => void stop()
  signal?.addEventListener('abort', onAbort, { once: true })
  // (an error of a dropped connection after the end — not the app's crash)
  client.on('error', () => undefined)
  try {
    if (signal?.aborted) throw new SqlError('Запрос остановлен')
    await client.connect()
    pid = (client as unknown as { processID?: number }).processID
    if (signal?.aborted) throw new SqlError('Запрос остановлен')
    const server = String((await client.query('show server_version')).rows[0]?.server_version ?? '')
    await client.query('begin read only')
    if (mode === 'run') {
      const t0 = performance.now()
      const cur = client.query(new Cursor(text, values, { rowMode: 'array' }))
      const { rows, fields } = await new Promise<{ rows: unknown[][]; fields: Array<{ name: string; dataTypeID: number }> }>((ok, no) =>
        cur.read(lim.maxRows + 1, (err, rows, result) => (err ? no(err) : ok({ rows: rows as unknown[][], fields: (result as unknown as { fields: Array<{ name: string; dataTypeID: number }> }).fields ?? [] }))),
      )
      const ms = performance.now() - t0
      await new Promise<void>((ok) => cur.close(() => ok()))
      const columns: SqlColumn[] = fields.map((f) => ({ name: f.name, type: PG_TYPES[f.dataTypeID] }))
      return { server: `PostgreSQL ${server}`, result: { columns, rows: rows.slice(0, lim.maxRows).map((r) => r.map(cell)), more: rows.length > lim.maxRows, ms, server: `PostgreSQL ${server}` } }
    }
    // the plan: without running it (what the planner thinks), or run (ANALYZE: real times — inside the read-only
    // transaction, rolled back)
    const r = await client.query(`explain (format json${mode === 'analyze' ? ', analyze, buffers' : ''}) ${text}`, values)
    const raw = r.rows[0]?.['QUERY PLAN'] as unknown
    return { server: `PostgreSQL ${server}`, plan: pgPlan(raw), planRaw: JSON.stringify(raw, null, 2) }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    // whatever happened: rolled back (nothing held), disconnected (an end that hangs — the socket dropped)
    await within(client.query('rollback'), 3000).catch(() => undefined)
    await within(client.end(), 3000).catch(() => (client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy())
  }
}

// ---------- MySQL / MariaDB ----------
type MyConn = mysql.Connection
const myConfig = (c: DbConn): mysql.ConnectionOptions => ({
  host: c.host,
  port: c.port ?? 3306,
  database: c.database || undefined,
  user: c.user,
  password: c.password,
  ssl: tlsOf(c),
  connectTimeout: DB_DEFAULTS.connectSec * 1000,
  multipleStatements: false,
  supportBigNumbers: true,
  // (a big number that would lose digits — as its text; the rest as numbers)
  bigNumberStrings: false,
  dateStrings: true,
  rowsAsArray: true,
})
const q = (conn: MyConn, sql: string, values: unknown[] = [], timeout?: number) =>
  new Promise<{ rows: unknown[]; fields: mysql.FieldPacket[] }>((ok, no) => conn.query({ sql, values, rowsAsArray: true, ...(timeout ? { timeout } : {}) }, (err, rows, fields) => (err ? no(err) : ok({ rows: rows as unknown[], fields: (fields ?? []) as mysql.FieldPacket[] }))))
const connect = (c: DbConn) =>
  new Promise<MyConn>((ok, no) => {
    const conn = mysql.createConnection(myConfig(c))
    conn.connect((err) => (err ? (conn.destroy(), no(err)) : ok(conn)))
  })
async function runMysql(c: DbConn, text: string, values: unknown[], mode: SqlMode, lim: ReturnType<typeof limits>, signal?: AbortSignal): Promise<SqlRun> {
  if (signal?.aborted) throw new SqlError('Запрос остановлен')
  const conn = await connect(c)
  conn.on('error', () => undefined)
  const thread = conn.threadId
  // stopped / too many rows: the query killed on the server from a second connection, this one dropped
  const kill = async () => {
    const k = await within(connect(c), 8000).catch(() => undefined)
    if (k) {
      await within(q(k, `KILL QUERY ${Number(thread)}`), 5000).catch(() => undefined)
      k.destroy()
    }
    conn.destroy()
  }
  const onAbort = () => void kill()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const version = String(((await q(conn, 'select version()')).rows[0] as unknown[])[0] ?? '')
    const maria = /mariadb/i.test(version)
    // the session's limits — each apart (an older server may not know one of them)
    for (const s of [
      'SET SESSION TRANSACTION READ ONLY',
      // a lock of another session waited for a few seconds only (the metadata lock's default — a year)
      `SET SESSION lock_wait_timeout = ${lim.lockSec}`,
      `SET SESSION innodb_lock_wait_timeout = ${lim.lockSec}`,
      maria ? `SET SESSION max_statement_time = ${lim.timeoutSec}` : `SET SESSION max_execution_time = ${lim.timeoutSec * 1000}`,
      // the session left idle (the app gone) — closed by the server
      'SET SESSION wait_timeout = 60',
    ])
      await q(conn, s).catch(() => undefined)
    await q(conn, 'START TRANSACTION READ ONLY')
    const server = `${maria ? 'MariaDB' : 'MySQL'} ${version}`
    if (mode === 'run') {
      const t0 = performance.now()
      // the rows streamed: past the limit — the query killed (the rest never fetched)
      const out = await new Promise<{ rows: unknown[][]; fields: mysql.FieldPacket[]; more: boolean }>((ok, no) => {
        const rows: unknown[][] = []
        let fields: mysql.FieldPacket[] = []
        let more = false
        let done = false
        const qr = conn.query({ sql: text, values, rowsAsArray: true, timeout: (lim.timeoutSec + 10) * 1000 })
        qr.on('fields', (f: mysql.FieldPacket[]) => (fields = f))
        qr.on('result', (r: unknown) => {
          if (done) return
          if (Array.isArray(r)) {
            if (rows.length >= lim.maxRows) {
              more = done = true
              // (answered once the query is killed and both connections closed — nothing of ours left on the server)
              void kill().finally(() => ok({ rows, fields, more }))
              return
            }
            rows.push(r)
          }
        })
        qr.on('error', (e: Error) => !done && ((done = true), no(e)))
        qr.on('end', () => !done && ((done = true), ok({ rows, fields, more })))
      })
      const ms = performance.now() - t0
      return { server, result: { columns: out.fields.map((f) => ({ name: f.name, type: String((f as { columnType?: number }).columnType ?? '') || undefined })), rows: out.rows.map((r) => r.map(cell)), more: out.more, ms, server } }
    }
    if (mode === 'analyze') {
      // MariaDB: ANALYZE FORMAT=JSON (run, with real times); MySQL 8.0.18+: EXPLAIN ANALYZE (a text tree)
      const r = await q(conn, maria ? `ANALYZE FORMAT=JSON ${text}` : `EXPLAIN ANALYZE ${text}`, values, (lim.timeoutSec + 10) * 1000)
      const raw = String(((r.rows[0] as unknown[]) ?? [])[0] ?? '')
      return { server, plan: maria ? mysqlJsonPlan(JSON.parse(raw)) : mysqlAnalyzePlan(raw), planRaw: raw }
    }
    const r = await q(conn, `EXPLAIN FORMAT=JSON ${text}`, values)
    const raw = String(((r.rows[0] as unknown[]) ?? [])[0] ?? '')
    return { server, plan: mysqlJsonPlan(JSON.parse(raw)), planRaw: raw }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await within(q(conn, 'ROLLBACK'), 3000).catch(() => undefined)
    await within(new Promise<void>((ok) => conn.end(() => ok())), 3000).catch(() => undefined)
    conn.destroy()
  }
}

// ---------- SQLite (a worker's: its time bounded by the process that runs it) ----------
async function runSqlite(c: DbConn, text: string, values: unknown[], mode: SqlMode, lim: ReturnType<typeof limits>): Promise<SqlRun> {
  if (!c.file) throw new SqlError('Не указан файл базы SQLite')
  const { DatabaseSync } = await import('node:sqlite')
  // read-only: the file opened so, its queries kept so; a writer's lock waited for a few seconds only
  const db = new DatabaseSync(c.file, { readOnly: true, timeout: lim.lockSec * 1000 } as ConstructorParameters<typeof DatabaseSync>[1])
  try {
    db.exec('PRAGMA query_only = ON')
    const server = `SQLite ${String((db.prepare('select sqlite_version() as v').get() as { v: string }).v)}`
    const vals = values.map((v) => (Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? Number(v) : v)) as Array<string | number | null>
    if (mode !== 'run') {
      const rows = db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...vals) as Array<{ id: number; parent: number; detail: string }>
      const plan = sqlitePlan(rows)
      if (mode === 'analyze') {
        // no ANALYZE in SQLite: the query run (its rows counted), its time measured
        const t0 = performance.now()
        let n = 0
        for (const _ of db.prepare(text).iterate(...vals)) if (++n > 1_000_000) break
        plan.executionMs = performance.now() - t0
        plan.analyzed = true
        plan.root.act = { rows: n, ms: plan.executionMs, loops: 1 }
      }
      return { server, plan, planRaw: rows.map((r) => `${r.id}\t${r.parent}\t${r.detail}`).join('\n') }
    }
    const st = db.prepare(text)
    const cols = (st as unknown as { columns?: () => Array<{ name: string; type: string | null }> }).columns?.()
    ;(st as unknown as { setReturnArrays?: (on: boolean) => void }).setReturnArrays?.(true)
    const t0 = performance.now()
    const rows: unknown[][] = []
    let more = false
    let keys: string[] | undefined
    for (const r of st.iterate(...vals)) {
      if (rows.length >= lim.maxRows) {
        more = true
        break
      }
      if (!Array.isArray(r)) keys ??= Object.keys(r as object)
      rows.push(Array.isArray(r) ? r : Object.values(r as object))
    }
    const ms = performance.now() - t0
    const columns = cols ? cols.map((x) => ({ name: x.name, type: x.type ?? undefined })) : (keys ?? []).map((name) => ({ name }))
    return { server, result: { columns, rows: rows.map((r) => r.map(cell)), more, ms, server } }
  } finally {
    db.close()
  }
}
