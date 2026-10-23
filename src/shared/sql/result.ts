import type { Plan } from '../sqlPlan'

/** A query's result and run: its columns and rows, how they are shown, published and written out. */
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
/** A query run (its rows), or its plan without running it, or run and measured (ANALYZE). */
export type SqlMode = 'run' | 'plan' | 'analyze'
export interface SqlRun {
  result?: SqlResult
  plan?: Plan
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
/** The rows as CSV (RFC 4180: «,», quoted when needed; a BOM — Excel reads it as UTF-8). */
export function rowsCsv(columns: SqlColumn[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `﻿${[columns.map((c) => esc(c.name)).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')}\r\n`
}
