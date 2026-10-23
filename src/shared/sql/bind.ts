import type { DbKind } from './connection'
import { tokens } from './tokens'

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
