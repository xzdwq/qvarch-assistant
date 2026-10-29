/**
 * What an ER diagram lights, by what is pointed at or picked: a reference (its line and the two columns it joins), a
 * column (its own references and the columns at their other ends — none: nothing), a table (all its references, moving,
 * and their columns). A pick (a click) stays until another one or a click on the empty place; what is pointed at is
 * lit beside it. And a column's kind of type — each drawn in its own colour.
 */

/** A reference between two columns, as the diagram draws it. */
export interface ErLine {
  id: string
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}
export type ErFocus = { kind: 'line'; id: string } | { kind: 'column'; table: string; column: string } | { kind: 'table'; table: string }

/** What is lit: the lines, the columns (`table|column`), whether the lines move (a table pointed at). */
export interface ErLit {
  lines: Set<string>
  columns: Set<string>
  moving: boolean
}
export const colId = (table: string, column: string) => `${table}|${column}`
const NONE = (): ErLit => ({ lines: new Set(), columns: new Set(), moving: false })

/** What one focus lights. */
function litOf(f: ErFocus | undefined, lines: readonly ErLine[]): ErLit {
  const out = NONE()
  if (!f) return out
  const take = (l: ErLine) => {
    out.lines.add(l.id)
    out.columns.add(colId(l.fromTable, l.fromColumn))
    out.columns.add(colId(l.toTable, l.toColumn))
  }
  /** Each kind of focus: which lines it takes. */
  const TAKES: { [K in ErFocus['kind']]: (f: Extract<ErFocus, { kind: K }>, l: ErLine) => boolean } = {
    line: (f, l) => l.id === f.id,
    column: (f, l) => (l.fromTable === f.table && l.fromColumn === f.column) || (l.toTable === f.table && l.toColumn === f.column),
    table: (f, l) => l.fromTable === f.table || l.toTable === f.table,
  }
  for (const l of lines) if ((TAKES[f.kind] as (f: ErFocus, l: ErLine) => boolean)(f, l)) take(l)
  out.moving = f.kind === 'table'
  return out
}
/** What the pick and what is pointed at light, together. */
export function erLit(lines: readonly ErLine[], picked?: ErFocus, pointed?: ErFocus): ErLit {
  const a = litOf(picked, lines)
  const b = litOf(pointed, lines)
  return { lines: new Set([...a.lines, ...b.lines]), columns: new Set([...a.columns, ...b.columns]), moving: a.moving || b.moving }
}
/** A column has references to light (a click on one without — no pick). */
export const hasLines = (lines: readonly ErLine[], table: string, column: string) => lines.some((l) => (l.fromTable === table && l.fromColumn === column) || (l.toTable === table && l.toColumn === column))

/** The kinds of a column's type, each its own colour; the first whose words the type has (none — other). */
export const ER_TYPE_KINDS = ['number', 'text', 'time', 'bool', 'json', 'uuid', 'binary', 'other'] as const
export type ErTypeKind = (typeof ER_TYPE_KINDS)[number]
const TYPE_WORDS: ReadonlyArray<[ErTypeKind, RegExp]> = [
  ['uuid', /uuid|guid|uniqueidentifier/i],
  ['json', /json|xml|hstore/i],
  ['bool', /bool|bit\b/i],
  ['time', /date|time|interval|year/i],
  ['binary', /blob|bytea|binary|image/i],
  ['number', /int|serial|num|dec|real|float|double|money|bit/i],
  ['text', /char|text|string|clob|enum|citext|name/i],
]
export const erTypeKind = (type?: string): ErTypeKind => (type ? (TYPE_WORDS.find(([, re]) => re.test(type))?.[0] ?? 'other') : 'other')
