import type { DbKind } from './connection'
import { isPunct, tokens } from './tokens'

/** What may be sent: one reading statement, nothing that writes, locks or reaches out of the server. */

/** The statements a read-only query may start with. */
const READ_START = new Set(['select', 'with', 'values', 'table', 'show', 'explain', 'describe', 'desc', 'pragma'])
/**
 * What could write inside one reading statement: a data-changing CTE (WITH d AS (DELETE … RETURNING …) SELECT …) —
 * reserved words everywhere, so a bare one is never a column's name. (Anything else that writes — DROP, SET, BEGIN,
 * COPY… — would have to start a statement of its own: one statement only, starting with a reading word.)
 */
const WRITE_WORDS = new Set(['insert', 'update', 'delete'])
/** The words after FOR that make a reading statement lock its rows (FOR UPDATE / SHARE / NO KEY UPDATE / KEY SHARE). */
const LOCKING_FOR = new Set(['update', 'share', 'no', 'key'])
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
  const semi = toks.findIndex((t) => isPunct(t, ';'))
  if (semi >= 0 && toks.slice(semi + 1).some((t) => !isPunct(t, ';'))) return { ok: false, why: 'Несколько запросов через «;» — выполняется только один' }
  const words = toks.filter((t) => t.t === 'word')
  const first = words[0]?.v
  if (!first || !READ_START.has(first)) return { ok: false, why: `Только чтение: запрос должен начинаться с SELECT / WITH / VALUES / SHOW / EXPLAIN${first ? ` (а начинается с ${first.toUpperCase()})` : ''}` }
  if (first === 'pragma' && kind !== 'sqlite') return { ok: false, why: 'PRAGMA — только для SQLite' }
  // PRAGMA x = y writes a setting
  if (first === 'pragma' && toks.some((t) => isPunct(t, '='))) return { ok: false, why: 'PRAGMA с присваиванием меняет настройки — только чтение' }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t !== 'word') continue
    const next = toks[i + 1]
    const prev = toks[i - 1]
    // a word right after «.» or «as» is a name (t.update, as delete), not a statement
    const isName = isPunct(prev, '.') || prev?.v === 'as'
    if (isName) continue
    if (BAD_FUNCS.has(t.v) && isPunct(next, '(')) return { ok: false, why: `${t.v}() — берёт блокировку, завершает сеансы или выходит за пределы базы; не выполняется` }
    if (t.v === 'for' && LOCKING_FOR.has(next?.v ?? '')) return { ok: false, why: 'FOR UPDATE / FOR SHARE — блокирующее чтение (держит строки); не выполняется' }
    if (t.v === 'lock' && toks[i + 1]?.v === 'in' && toks[i + 2]?.v === 'share') return { ok: false, why: 'LOCK IN SHARE MODE — блокирующее чтение; не выполняется' }
    if (t.v === 'into') return { ok: false, why: 'SELECT … INTO создаёт таблицу или пишет в файл; не выполняется' }
    if (WRITE_WORDS.has(t.v) || (t.v === 'merge' && next?.v === 'into')) return { ok: false, why: `${t.v.toUpperCase()} — только чтение: запросы, которые меняют данные, не выполняются` }
  }
  return { ok: true }
}
