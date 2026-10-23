/** A table of values (a query's rows, a variable's data, a loop's rows gathered): its columns and its rows. */
export interface GridData {
  columns: Array<{ name: string; type?: string }>
  rows: unknown[][]
}

/**
 * Any value as a table: an array of objects — a row each, the columns all the keys met (in the order met); an array
 * of plain values — one column «значение»; an array of arrays — as they are; an object — its keys the columns, one
 * row; a plain value — one cell.
 */
export function asGrid(v: unknown): GridData {
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => Array.isArray(x))) {
      const n = Math.max(...v.map((x) => (x as unknown[]).length))
      return { columns: Array.from({ length: n }, (_, i) => ({ name: String(i) })), rows: v.map((x) => Array.from({ length: n }, (_, i) => (x as unknown[])[i] ?? null)) }
    }
    if (v.length && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
      const cols: string[] = []
      const seen = new Set<string>()
      for (const x of v) for (const k of Object.keys(x as object)) if (!seen.has(k)) (seen.add(k), cols.push(k))
      return { columns: cols.map((name) => ({ name })), rows: v.map((x) => cols.map((k) => (x as Record<string, unknown>)[k] ?? null)) }
    }
    return { columns: [{ name: 'значение' }], rows: v.map((x) => [x ?? null]) }
  }
  if (v !== null && typeof v === 'object') return asGrid([v])
  return { columns: [{ name: 'значение' }], rows: [[v ?? null]] }
}
