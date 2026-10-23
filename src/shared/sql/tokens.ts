import type { DbKind } from './connection'

/** A query read: comments dropped; strings, quoted names, parameters kept whole. */
export type Tok = { t: 'word' | 'str' | 'qid' | 'punct' | 'num' | 'param'; v: string; at: number; end: number }
/** A punctuation token, and that one character. */
export const isPunct = (t: Tok | undefined, v: string): boolean => t?.t === 'punct' && t.v === v

/** The letters a string may be prefixed with (E'…', N'…'), and those of them where a backslash escapes. */
const STRING_PREFIXES = new Set(['E', 'e', 'N', 'n'])
const ESCAPE_PREFIXES = new Set(['E', 'e'])
/** The quoted names' opening marks and their closing ones. */
const NAME_QUOTES: Record<string, string> = { '"': '"', '`': '`', '[': ']' }

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
    if (c === "'" || (STRING_PREFIXES.has(c) && sql[i + 1] === "'")) {
      if (c !== "'") i++
      i++
      while (i < n) {
        if (sql[i] === '\\' && (my || ESCAPE_PREFIXES.has(c))) i += 2
        else if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out.push({ t: 'str', v: sql.slice(start, i), at: start, end: i })
      continue
    }
    if (Object.hasOwn(NAME_QUOTES, c)) {
      const close = NAME_QUOTES[c]
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
