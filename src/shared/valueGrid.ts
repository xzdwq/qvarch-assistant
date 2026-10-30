/**
 * A value laid out as a table — its head and rows, each cell made by `cell` (a note's table: text; a file: the value
 * itself, a number staying a number): a list of objects — a row each, every key met a column (in the order met; a key
 * a row lacks — an empty cell); a list of plain values — one column; one object — its keys the columns, one row; a
 * list of lists — as they are; a plain value — one cell.
 */
export function valueGrid<C>(v: unknown, cell: (x: unknown) => C): { head: string[]; rows: C[][] } {
  const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
  const objects = (xs: Array<Record<string, unknown>>) => {
    const head: string[] = []
    const seen = new Set<string>()
    for (const x of xs) for (const k of Object.keys(x)) if (!seen.has(k)) (seen.add(k), head.push(k))
    return { head: head.length ? head : ['значение'], rows: xs.map((x) => (head.length ? head.map((k) => cell(x[k])) : [cell('')])) }
  }
  if (Array.isArray(v)) {
    if (v.length && v.every(isObj)) return objects(v)
    if (v.length && v.every((x) => Array.isArray(x))) {
      const n = Math.max(1, ...v.map((x) => (x as unknown[]).length))
      return { head: Array.from({ length: n }, (_, i) => `Столбец ${i + 1}`), rows: v.map((x) => Array.from({ length: n }, (_, i) => cell((x as unknown[])[i]))) }
    }
    return { head: ['значение'], rows: v.map((x) => [cell(x)]) }
  }
  if (isObj(v)) return objects([v])
  return { head: ['значение'], rows: [[cell(v)]] }
}
/** A value laid out as rows at all (a list, an object) — not a single text or number. */
export const isTabular = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 && v.every((x) => x !== null && typeof x === 'object') : false
