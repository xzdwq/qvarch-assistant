/**
 * «@бд»: a query to a database (PostgreSQL, MySQL / MariaDB, SQLite) from a note — read only, one connection per
 * query (opened, used, closed), never a lock waited for long nor held: what is safe to send is decided here, before
 * anything reaches the server.
 */
export type DbKind = 'pg' | 'mysql' | 'sqlite'
export const DB_KINDS: Array<{ id: DbKind; title: string; port?: number }> = [
  { id: 'pg', title: 'PostgreSQL', port: 5432 },
  { id: 'mysql', title: 'MySQL / MariaDB', port: 3306 },
  { id: 'sqlite', title: 'SQLite' },
]
/** A connection as the settings keep it (the password apart, encrypted; never in a note). */
export interface DbConn {
  id: string
  /** What a note calls it: ```sql db=<name>. */
  name: string
  kind: DbKind
  host?: string
  port?: number
  database?: string
  user?: string
  /** The password: only going in (to be saved); what comes out says only whether there is one. */
  password?: string
  hasPassword?: boolean
  /** TLS: off, required with the certificate checked, required without the check (a self-signed one). */
  ssl?: 'off' | 'verify' | 'no-verify'
  /** SQLite: the file. */
  file?: string
  /** A query's time on the server, s (then it is cancelled). */
  timeoutSec?: number
  /** How long a lock held by another session is waited for, s (then the query gives up — nothing waits behind it). */
  lockSec?: number
  /** Rows read at most (the rest not fetched). */
  maxRows?: number
  /** Marked as production: shown so (it is read-only as every connection is). */
  prod?: boolean
}
export const DB_DEFAULTS = { timeoutSec: 30, lockSec: 3, maxRows: 1000, connectSec: 10 }
export const connName = (s: string) => /^[\p{L}\p{N}_.-]{1,60}$/u.test(s)

// ---------- the query read: comments, strings, quoted names apart ----------
type Tok = { t: 'word' | 'str' | 'qid' | 'punct' | 'num' | 'param'; v: string; at: number; end: number }
/**
 * The query in tokens (comments dropped). Dollar-quoted ($$…$$, $tag$…$tag$), '…', E'…', "…", `…`, […] kept whole.
 * By the database's rules: MySQL — «#» starts a comment, a backslash escapes in any '…'; elsewhere «#» is an
 * operator and only E'…' knows backslashes.
 */
export function tokens(sql: string, kind: DbKind = 'pg'): Tok[] {
  const my = kind === 'mysql'
  const out: Tok[] = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (my && c === '#') {
      // (MySQL's comment)
      while (i < n && sql[i] !== '\n') i++
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 0
      do {
        if (sql[i] === '/' && sql[i + 1] === '*') ((depth++), (i += 2))
        else if (sql[i] === '*' && sql[i + 1] === '/') ((depth--), (i += 2))
        else i++
      } while (i < n && depth > 0)
      continue
    }
    const start = i
    if (c === "'" || ((c === 'E' || c === 'e' || c === 'N' || c === 'n') && sql[i + 1] === "'")) {
      if (c !== "'") i++
      i++
      while (i < n) {
        if (sql[i] === '\\' && (my || c === 'E' || c === 'e')) i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out.push({ t: 'str', v: sql.slice(start, i), at: start, end: i })
      continue
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < n && !(sql[i] === close && sql[i + 1] !== close)) i += sql[i] === close ? 2 : 1
      i++
      out.push({ t: 'qid', v: sql.slice(start, i), at: start, end: i })
      continue
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        i = close < 0 ? n : close + tag.length
        out.push({ t: 'str', v: sql.slice(start, i), at: start, end: i })
        continue
      }
      const p = /^\$\d+/.exec(sql.slice(i))
      if (p) {
        i += p[0].length
        out.push({ t: 'param', v: p[0], at: start, end: i })
        continue
      }
    }
    if (c === '{' && sql[i + 1] === '{') {
      const close = sql.indexOf('}}', i + 2)
      i = close < 0 ? n : close + 2
      out.push({ t: 'param', v: sql.slice(start, i), at: start, end: i })
      continue
    }
    if (/[\p{L}_]/u.test(c)) {
      while (i < n && /[\p{L}\p{N}_$]/u.test(sql[i])) i++
      out.push({ t: 'word', v: sql.slice(start, i).toLowerCase(), at: start, end: i })
      continue
    }
    if (/\d/.test(c)) {
      while (i < n && /[\d.eE]/.test(sql[i])) i++
      out.push({ t: 'num', v: sql.slice(start, i), at: start, end: i })
      continue
    }
    out.push({ t: 'punct', v: c, at: start, end: i + 1 })
    i++
  }
  return out
}

// ---------- what may be sent ----------
/** The statements a read-only query may start with. */
const READ_START = new Set(['select', 'with', 'values', 'table', 'show', 'explain', 'describe', 'desc', 'pragma'])
/**
 * What could write inside one reading statement: a data-changing CTE (WITH d AS (DELETE … RETURNING …) SELECT …) —
 * reserved words everywhere, so a bare one is never a column's name. (Anything else that writes — DROP, SET, BEGIN,
 * COPY… — would have to start a statement of its own: one statement only, starting with a reading word.)
 */
const WRITE_WORDS = new Set(['insert', 'update', 'delete'])
/** Functions that take a lock, end other sessions, sleep a server down or reach out of it. */
const BAD_FUNCS = new Set(['pg_advisory_lock', 'pg_advisory_lock_shared', 'pg_advisory_xact_lock', 'pg_advisory_xact_lock_shared', 'pg_try_advisory_lock', 'pg_try_advisory_xact_lock', 'get_lock', 'release_lock', 'release_all_locks', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile', 'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'lo_import', 'lo_export', 'dblink', 'dblink_exec', 'set_config', 'nextval', 'setval', 'load_file', 'sys_exec', 'sys_eval', 'benchmark', 'pg_switch_wal', 'txid_current', 'pg_current_xact_id'])
export interface Guard {
  ok: boolean
  /** Why not (said to the person). */
  why?: string
}
/**
 * May this query be sent: one statement, a reading one (select / with / values / table / show / explain), nothing
 * in it that writes, locks (for update / for share / lock in share mode), ends sessions or reads the server's files.
 * The server is read-only besides (a read-only transaction rolled back) — this is the first wall, not the only.
 */
export function guardSql(sql: string, kind: DbKind): Guard {
  const toks = tokens(sql, kind)
  if (!toks.length) return { ok: false, why: 'Пустой запрос' }
  // one statement (a «;» at its end only)
  const semi = toks.findIndex((t) => t.t === 'punct' && t.v === ';')
  if (semi >= 0 && toks.slice(semi + 1).some((t) => !(t.t === 'punct' && t.v === ';'))) return { ok: false, why: 'Несколько запросов через «;» — выполняется только один' }
  const words = toks.filter((t) => t.t === 'word')
  const first = words[0]?.v
  if (!first || !READ_START.has(first)) return { ok: false, why: `Только чтение: запрос должен начинаться с SELECT / WITH / VALUES / SHOW / EXPLAIN${first ? ` (а начинается с ${first.toUpperCase()})` : ''}` }
  if (first === 'pragma' && kind !== 'sqlite') return { ok: false, why: 'PRAGMA — только для SQLite' }
  // PRAGMA x = y writes a setting
  if (first === 'pragma' && toks.some((t) => t.t === 'punct' && t.v === '=')) return { ok: false, why: 'PRAGMA с присваиванием меняет настройки — только чтение' }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== 'word') continue
    const next = toks[i + 1]
    const prev = toks[i - 1]
    // a word right after «.» or «as» is a name (t.update, as delete), not a statement
    const isName = (prev?.t === 'punct' && prev.v === '.') || prev?.v === 'as'
    if (isName) continue
    if (BAD_FUNCS.has(t.v) && next?.t === 'punct' && next.v === '(') return { ok: false, why: `${t.v}() — берёт блокировку, завершает сеансы или выходит за пределы базы; не выполняется` }
    if (t.v === 'for' && ['update', 'share', 'no', 'key'].includes(toks[i + 1]?.v ?? '')) return { ok: false, why: 'FOR UPDATE / FOR SHARE — блокирующее чтение (держит строки); не выполняется' }
    if (t.v === 'lock' && toks[i + 1]?.v === 'in' && toks[i + 2]?.v === 'share') return { ok: false, why: 'LOCK IN SHARE MODE — блокирующее чтение; не выполняется' }
    if (t.v === 'into') return { ok: false, why: 'SELECT … INTO создаёт таблицу или пишет в файл; не выполняется' }
    if (WRITE_WORDS.has(t.v) || (t.v === 'merge' && next?.v === 'into')) return { ok: false, why: `${t.v.toUpperCase()} — только чтение: запросы, которые меняют данные, не выполняются` }
  }
  return { ok: true }
}

// ---------- the note's values into the query ----------
/**
 * {{ path }} of the note's context into the query — never into its text: outside quotes — a parameter the driver
 * sends apart ($1 for PostgreSQL, ? for the others); a quoted string holding {{ … }} ('%{{q}}%') — the whole string
 * becomes one parameter, its text put together here (the value as it is: a quote, a backslash in it stay the value's
 * own — nothing to break out of). A name ("…", `…`) or a $$-string with {{ … }} — refused (a parameter cannot be a
 * name). An array goes as one parameter (PostgreSQL: = ANY($1)); MySQL: IN (?) — the driver lists it, escaped.
 */
export function bindSql(sql: string, kind: DbKind, resolve: (path: string) => { ok: boolean; value?: unknown }): { text: string; values: unknown[]; missing: string[]; error?: string } {
  const values: unknown[] = []
  const missing: string[] = []
  const val = (v: unknown) => (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v)
  const place = () => (kind === 'pg' ? `$${values.length}` : '?')
  let out = ''
  let at = 0
  for (const t of tokens(sql, kind)) {
    if ((t.t === 'qid' || (t.t === 'str' && t.v.startsWith('$'))) && t.v.includes('{{'))
      return { text: sql, values: [], missing: [], error: `Подстановка {{…}} внутри ${t.t === 'qid' ? 'имени в кавычках' : 'строки $$…$$'} не выполняется — значение может быть только параметром (в обычной строке '…' или вне кавычек)` }
    if (t.t === 'str' && t.v.includes('{{')) {
      // the literal's own text (its quotes off, its escapes read) with the values put in — sent as a parameter
      const e = /^[eE]'/.test(t.v)
      const body = t.v.replace(/^[eEnN]?'/, '').replace(/'$/, '')
      const backslash = e || kind === 'mysql'
      const unescaped = (backslash ? body.replace(/\\(.)/g, (_a, c: string) => ({ n: '\n', t: '\t', r: '\r', '0': '\0' })[c] ?? c) : body).replace(/''/g, "'")
      let lost = false
      const text = unescaped.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, p: string) => {
        const r = resolve(p)
        if (!r.ok) return (missing.push(p), (lost = true), all)
        return r.value === null || r.value === undefined ? '' : typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
      })
      out += sql.slice(at, t.at)
      if (lost) out += t.v
      else {
        values.push(text)
        out += place()
      }
      at = t.end
      continue
    }
    if (t.t !== 'param' || !t.v.startsWith('{{')) continue
    const p = t.v.slice(2, -2).trim()
    const r = resolve(p)
    out += sql.slice(at, t.at)
    if (!r.ok) {
      missing.push(p)
      out += t.v
    } else {
      values.push(val(r.value))
      out += place()
    }
    at = t.end
  }
  return { text: out + sql.slice(at), values, missing }
}

// ---------- a result ----------
export interface SqlColumn {
  name: string
  type?: string
}
export interface SqlResult {
  columns: SqlColumn[]
  /** Rows as arrays (the columns' order). */
  rows: unknown[][]
  /** More rows were there than read (maxRows). */
  more: boolean
  ms: number
  /** The server's word (its version). */
  server?: string
}
/** A value as it can be shown and published (bytes, big numbers, dates — as text). */
export function plainValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  // (bytes: a Buffer is one too)
  if (v instanceof Uint8Array) return `<${v.length} байт>`
  if (Array.isArray(v)) return v.map(plainValue)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plainValue(x)]))
  return v
}
/** The rows as the note's context has them: objects by column (a repeated name — name_2). */
export function rowsAsObjects(r: Pick<SqlResult, 'columns' | 'rows'>): Array<Record<string, unknown>> {
  const names: string[] = []
  for (const c of r.columns) {
    let n = c.name || 'column'
    for (let k = 2; names.includes(n); k++) n = `${c.name}_${k}`
    names.push(n)
  }
  return r.rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])))
}

/** A query run (its rows), or its plan without running it, or run and measured (ANALYZE). */
export type SqlMode = 'run' | 'plan' | 'analyze'
export interface SqlRun {
  result?: SqlResult
  plan?: import('./sqlPlan').Plan
  /** The plan as the server gave it (JSON / text). */
  planRaw?: string
  server?: string
}
export interface SqlRunOut {
  ok: boolean
  run?: SqlRun
  error?: string
  ms: number
}
/** A database's tables and their columns (for completion while typing a query). */
export interface DbSchema {
  /** The schema names go without (PostgreSQL's search path: public; MySQL's database). */
  defaultSchema?: string
  tables: Array<{ schema?: string; name: string; columns: Array<{ name: string; type?: string }> }>
  at: number
}
/** Rows from a query's result as one table: the page sends them, the file is written where the person says. */
export interface SqlExport {
  format: 'xlsx' | 'csv'
  /** The file's name offered (without its extension). */
  name: string
  columns: SqlColumn[]
  rows: unknown[][]
}
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
  /** The rows saved as a file (the system's «save as»); the file's path, or nothing when cancelled. */
  exportRows(x: SqlExport): Promise<string | undefined>
}
export const SQL_METHODS = ['conns', 'save', 'remove', 'run', 'stop', 'library', 'schema', 'exportRows'] as const
/** The rows as CSV (RFC 4180: «,», quoted when needed; a BOM — Excel reads it as UTF-8). */
export function rowsCsv(columns: SqlColumn[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `﻿${[columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')}\r\n`
}

// ---------- the notebook's queries: a library to take one from ----------
/** A query of the notebook: where it is (a note in a folder, its line), what it is called, its connection, its text. */
export interface SqlTemplate {
  /** The note (vault-relative, with its folders). */
  path: string
  line: number
  title: string
  /** The block's own name (what it publishes). */
  name?: string
  db: string
  sql: string
}
/** A query's title: its first line when that is a comment («-- Аналоги продукта»). */
export function sqlTitle(body: string): string | undefined {
  const first = body.split('\n').find((l) => l.trim())
  const m = first && /^\s*--\s*(.+?)\s*$/.exec(first)
  return m ? m[1] : undefined
}
/** The query's body with its title set (the first comment line written, replaced or taken away). */
export function withTitle(body: string, title: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => l.trim())
  const has = at >= 0 && /^\s*--/.test(lines[at])
  const t = title.trim().replace(/\n/g, ' ')
  if (has) t ? (lines[at] = `-- ${t}`) : lines.splice(at, 1)
  else if (t) lines.unshift(`-- ${t}`)
  return lines.join('\n')
}
/** Every ```sql db=… block of a note. */
export function sqlTemplates(path: string, text: string): SqlTemplate[] {
  const out: SqlTemplate[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(`{3,}|~{3,})\s*sql\b(.*)$/i.exec(lines[i])
    if (!m) continue
    const db = /(?:^|\s)db=(\S*)/.exec(m[2])
    let j = i + 1
    while (j < lines.length && !lines[j].startsWith(m[1])) j++
    if (db) {
      const body = lines.slice(i + 1, j).join('\n')
      const name = /(?:^|\s)name=(\S+)/.exec(m[2])?.[1]
      const firstLine = body.split('\n').find((l) => l.trim() && !/^\s*--/.test(l))?.trim() ?? ''
      out.push({ path, line: i + 1, title: sqlTitle(body) ?? name ?? (firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine || 'Запрос'), name, db: db[1], sql: body })
    }
    i = j
  }
  return out
}

// ---------- the errors said ----------
/** A driver's error in words: what happened, and that nothing is held. */
export function sqlErrorText(kind: DbKind, e: { code?: string | number; errno?: number; message?: string }, ctx: { timeoutSec: number; lockSec: number }): string {
  const code = String(e.code ?? '')
  const msg = (e.message ?? String(e)).split('\n')[0]
  if (kind === 'pg') {
    if (code === '55P03') return `Таблица или строки заняты другим сеансом — ждали ${ctx.lockSec} с и сняли запрос. Ничего не держим. (${msg})`
    if (code === '40P01') return `Взаимная блокировка (deadlock) — сервер снял запрос. Ничего не держим. (${msg})`
    if (code === '57014') return /statement timeout/i.test(msg) ? `Запрос шёл дольше ${ctx.timeoutSec} с — сервер его снял` : 'Запрос остановлен'
    if (code === '25006') return `Только чтение: ${msg}`
    if (code === '28P01' || code === '28000') return `Вход не удался: ${msg}`
    if (code === '3D000') return `Нет такой базы: ${msg}`
    if (code === '42P01') return `Нет такой таблицы: ${msg}`
  }
  if (kind === 'mysql') {
    if (code === 'ER_LOCK_WAIT_TIMEOUT' || e.errno === 1205) return `Строки заняты другим сеансом — ждали ${ctx.lockSec} с и сняли запрос. Ничего не держим.`
    if (code === 'ER_LOCK_DEADLOCK' || e.errno === 1213) return 'Взаимная блокировка (deadlock) — сервер снял запрос. Ничего не держим.'
    if (e.errno === 3024 || e.errno === 1969 || code === 'ER_QUERY_TIMEOUT' || code === 'ER_STATEMENT_TIMEOUT') return `Запрос шёл дольше ${ctx.timeoutSec} с — сервер его снял`
    if (code === 'ER_QUERY_INTERRUPTED' || e.errno === 1317) return 'Запрос остановлен'
    if (code === 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION' || e.errno === 1792) return `Только чтение: ${msg}`
    if (code === 'ER_ACCESS_DENIED_ERROR') return `Вход не удался: ${msg}`
  }
  if (kind === 'sqlite' && /SQLITE_BUSY|database is locked/i.test(msg)) return `Файл базы занят другой программой — ждали ${ctx.lockSec} с. Ничего не держим.`
  if (/ECONNREFUSED/.test(code + msg)) return `Сервер не принимает подключение (${msg})`
  if (/ETIMEDOUT|timeout expired|connect timeout/i.test(code + msg)) return `Не удалось подключиться за ${DB_DEFAULTS.connectSec} с (${msg})`
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return `Нет такого хоста (${msg})`
  return msg
}
