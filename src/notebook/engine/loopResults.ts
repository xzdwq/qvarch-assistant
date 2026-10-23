import { asGrid, type GridData } from '../../shared/gridData'
import type { RunnableKind } from '../blocks/specs'
import { isPlainValue } from './reports'
import { BLOCK_RUNNERS } from './runners'
import type { PassRun } from './runTypes'

/**
 * A block of a loop over its passes: what each pass gave (its published value; an unnamed block — from its run), and
 * all the passes gathered into one — a table (rows of a query one after another, a request's answers a row each,
 * code's values) or one text (a template's texts one after another).
 */

/** What a pass of the loop gave for a block (its published value, or what its run gave; undefined — nothing). */
export function passValue(kind: RunnableKind, p: PassRun, key: string, name?: string): unknown {
  if (name && name in p.values) return p.values[name]
  const r = p.runs?.[key]
  if (!r || r.state !== 'ok') return undefined
  return BLOCK_RUNNERS[kind].resultOf(r)
}
/** A pass's plain values (numbers, texts — the id, the counter) as columns beside its rows. */
const passVarColumns = (p: PassRun) => Object.fromEntries(Object.entries(p.vars).filter(([, v]) => isPlainValue(v)))

/** Every pass's result as one table: «№» (the pass), its plain values, then the result's own columns. */
export function accGrid(kind: RunnableKind, passes: PassRun[], key: string, name?: string): GridData {
  const rows: Array<Record<string, unknown>> = []
  const toRow = BLOCK_RUNNERS[kind].loopRow
  for (const p of passes) {
    const head = { '№': p.n, ...passVarColumns(p) }
    if (p.state === 'error' && !(name && name in p.values)) {
      rows.push({ ...head, ошибка: p.error ?? 'ошибка' })
      continue
    }
    const v = passValue(kind, p, key, name)
    if (v === undefined) continue
    for (const r of toRow ? [toRow(v)] : valueRows(v)) rows.push({ ...head, ...r })
  }
  return asGrid(rows)
}
const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x)
/** A pass's value as rows: a list of records — a row each, a record — one row, anything else — one «значение» cell. */
const valueRows = (v: unknown): object[] => (Array.isArray(v) && v.every(isRecord) ? v : isRecord(v) ? [v] : [{ значение: v }])
/** Every pass's text (a template's) one after another — a blank line between. */
export function accText(kind: RunnableKind, passes: PassRun[], key: string, name?: string): string {
  return passes
    .map((p) => passValue(kind, p, key, name))
    .filter((t): t is string => typeof t === 'string' && !!t.trim())
    .join('\n\n')
}
