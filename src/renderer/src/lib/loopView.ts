import { publishedAnswer } from '@shared/runbook'
import { rowsAsObjects } from '@shared/sql'
import { asGrid, type GridData } from './grid'
import type { PassRun } from './runbook'

/**
 * A block of a loop over its passes: what each pass gave (its published value; an unnamed block — from its run), and
 * all the passes gathered into one — a table (rows of a query one after another, a request's answers a row each,
 * code's values) or one text (a template's texts one after another).
 */
export type LoopBlockKind = 'http' | 'sql' | 'code' | 'pw' | 'tpl'

export function passValue(kind: LoopBlockKind, p: PassRun, key: string, name?: string): unknown {
  if (name && name in p.values) return p.values[name]
  const r = p.runs?.[key]
  if (!r || r.state !== 'ok') return undefined
  if (kind === 'http') return r.response ? publishedAnswer(r.response) : undefined
  if (kind === 'sql') return r.table ? rowsAsObjects(r.table) : undefined
  return r.hasValue ? r.value : undefined
}
const plainVal = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
/** A pass's plain values (numbers, texts — the id, the counter) as columns beside its rows. */
const varCols = (p: PassRun) => Object.fromEntries(Object.entries(p.vars).filter(([, v]) => plainVal(v)))

/** Every pass's result as one table: «№» (the pass), its plain values, then the result's own columns. */
export function accGrid(kind: LoopBlockKind, passes: PassRun[], key: string, name?: string): GridData {
  const rows: Array<Record<string, unknown>> = []
  for (const p of passes) {
    const head = { '№': p.n, ...varCols(p) }
    if (p.state === 'error' && !(name && name in p.values)) {
      rows.push({ ...head, ошибка: p.error ?? 'ошибка' })
      continue
    }
    const v = passValue(kind, p, key, name)
    if (v === undefined) continue
    if (kind === 'http') {
      const a = v as { status?: number; time?: number; body?: unknown }
      rows.push({ ...head, status: a.status, time: a.time, body: a.body })
    } else if (Array.isArray(v) && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) for (const r of v) rows.push({ ...head, ...(r as object) })
    else if (v !== null && typeof v === 'object' && !Array.isArray(v)) rows.push({ ...head, ...(v as object) })
    else rows.push({ ...head, значение: v })
  }
  return asGrid(rows)
}
/** Every pass's text (a template's) one after another — a blank line between. */
export function accText(passes: PassRun[], key: string, name?: string): string {
  return passes
    .map((p) => passValue('tpl', p, key, name))
    .filter((t): t is string => typeof t === 'string' && !!t.trim())
    .join('\n\n')
}
/** A pass in a few words: its number and its plain values (`№ 3 · i=2 · id=17`). */
export function passTitle(p: PassRun): string {
  const vs = Object.entries(p.vars)
    .filter(([, v]) => plainVal(v))
    .slice(0, 4)
    .map(([k, v]) => `${k}=${String(v).length > 24 ? `${String(v).slice(0, 24)}…` : String(v)}`)
  return [`№ ${p.n}`, ...vs].join(' · ')
}
