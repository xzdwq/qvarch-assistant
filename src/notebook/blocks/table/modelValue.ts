/**
 * A table as a value of the note (what code, templates and queries read under its name): its rows as objects, the
 * head their keys. Every row whole — a merged cell's text in each cell it covers; every key there and its own.
 */
import type { TableModel } from './model'
import { cellAt, coveredBy } from './modelMerges'

/**
 * The rows' keys, a column each: its head (under a merged head — the merge's); an empty one — «Столбец N»; met
 * again — with a number («Имя 2»), a key never lost to another column.
 */
export function tableKeys(t: TableModel): string[] {
  const seen = new Set<string>()
  return t.head.map((_, c) => {
    const m = coveredBy(t, -1, c)
    const base = (m ? t.head[m.c] : t.head[c]).trim() || `Столбец ${c + 1}`
    let key = base
    for (let n = 2; seen.has(key); n++) key = `${base} ${n}`
    seen.add(key)
    return key
  })
}
/** A body cell's text as the value has it: under a merge — the merge's. */
const valueCell = (t: TableModel, r: number, c: number) => {
  const m = coveredBy(t, r, c)
  return m ? cellAt(t, m.r, m.c) : cellAt(t, r, c)
}
/** The table's rows as objects (the cells — text, as typed): its value in the note, seen as JSON too. */
export function tableValue(t: TableModel): Array<Record<string, string>> {
  const keys = tableKeys(t)
  return t.rows.map((_, r) => Object.fromEntries(keys.map((k, c) => [k, valueCell(t, r, c)])))
}
