/**
 * The tables an SQL text works with, and how: read (FROM / JOIN), written (INSERT / UPDATE / DELETE / MERGE),
 * described (CREATE / ALTER / DROP). Not a parser — enough to link notes: comments, strings and {{templates}} put
 * aside, a WITH's names are not tables, `FROM func(` is not one, a schema is dropped from the key.
 */

export const SQL_USES = ['reads', 'writes', 'defines'] as const
export type SqlUse = (typeof SQL_USES)[number]

export interface SqlTable {
  use: SqlUse
  /** The key: the table's own name, lower case, unquoted. */
  name: string
  /** As written (with its schema). */
  label: string
  /** Its line in the text (0-based). */
  line: number
}

/** The words that open a table's name, and what the statement does to it. */
const OPENERS: ReadonlyArray<{ re: RegExp; use: SqlUse; list?: boolean }> = [
  { re: /\bdelete\s+from\s+/giy, use: 'writes' },
  { re: /\b(?:insert|merge)\s+into\s+/giy, use: 'writes' },
  { re: /\bupdate\s+(?:only\s+)?/giy, use: 'writes' },
  { re: /\btruncate\s+(?:table\s+)?/giy, use: 'writes' },
  { re: /\b(?:create|alter|drop)\s+(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(?:if\s+(?:not\s+)?exists\s+)?/giy, use: 'defines' },
  { re: /\bfrom\s+(?:only\s+|lateral\s+)?/giy, use: 'reads', list: true },
  { re: /\bjoin\s+(?:lateral\s+)?/giy, use: 'reads' },
]
/** One part of a name: plain, "quoted", [bracketed], `backticked`. */
const PART = String.raw`(?:"[^"]+"|\[[^\]]+\]|` + '`[^`]+`' + String.raw`|[\p{L}_][\p{L}\p{N}_$]*)`
const NAME = new RegExp(String.raw`${PART}(?:\s*\.\s*${PART}){0,2}`, 'uy')
/** Words that may stand where a name does, but are not tables. */
const NOT_TABLES = new Set(['select', 'lateral', 'unnest', 'dual', 'values', 'set', 'where', 'only', 'table', 'as', 'on', 'using'])
const ALIAS = /\s+(?:as\s+)?[\p{L}_][\p{L}\p{N}_$]*/uy
const unquote = (p: string) => p.trim().replace(/^["[`]|["\]`]$/g, '')

/** The text with what is not SQL code (comments, strings, templates) blanked — its length and lines kept. */
function codeOnly(sql: string): string {
  return sql
    .replace(/\{\{[^}]*\}\}\s*\.\s*/g, (m) => ' '.repeat(m.length))
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\{\{[^}]*\}\}/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The tables of an SQL text (each use of each table once, in order). */
export function sqlTables(sql: string): SqlTable[] {
  const text = codeOnly(sql)
  const ctes = new Set([...text.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s*([\p{L}_][\p{L}\p{N}_$]*)\s*(?:\([^)]*\)\s*)?as\s*\(/giu)].map((m) => m[1].toLowerCase()))
  const out: SqlTable[] = []
  const seen = new Set<string>()
  const lineAt = (at: number) => text.slice(0, at).split('\n').length - 1
  const add = (use: SqlUse, raw: string, at: number) => {
    const parts = raw.split(/\s*\.\s*/).map(unquote)
    const name = (parts[parts.length - 1] ?? '').toLowerCase()
    if (!name || NOT_TABLES.has(name) || (parts.length === 1 && ctes.has(name))) return
    const key = `${use}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ use, name, label: parts.join('.'), line: lineAt(at) })
  }
  /** A name at `at` (not a function's): its end; none — undefined. */
  const nameAt = (at: number, use: SqlUse): number | undefined => {
    NAME.lastIndex = at
    const m = NAME.exec(text)
    if (!m) return undefined
    const end = at + m[0].length
    if (/^\s*\(/.test(text.slice(end, end + 40)) && use === 'reads') return undefined
    add(use, m[0], at)
    return end
  }
  for (let i = 0; i < text.length; i++) {
    if (!/[a-z]/i.test(text[i]) || (i > 0 && /[\p{L}\p{N}_$]/u.test(text[i - 1]))) continue
    for (const o of OPENERS) {
      o.re.lastIndex = i
      const m = o.re.exec(text)
      if (!m) continue
      let end = nameAt(i + m[0].length, o.use)
      // FROM a x, b y — the list goes on
      while (o.list && end !== undefined) {
        ALIAS.lastIndex = end
        const al = ALIAS.exec(text)
        if (al && !/^\s*(?:as\s+)?(?:where|join|inner|left|right|full|cross|on|group|order|limit|union|having|natural|using|window|offset|fetch|for|returning)\b/i.test(al[0])) end += al[0].length
        const comma = /^\s*,\s*/.exec(text.slice(end))
        if (!comma) break
        end = nameAt(end + comma[0].length, o.use)
      }
      // (past what was read: DELETE FROM's FROM is not a read)
      i = (end ?? i + m[0].length) - 1
      break
    }
  }
  return out
}
