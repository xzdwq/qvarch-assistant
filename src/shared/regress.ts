import { QA_MARKS, type QaMark } from './browser/constants'

/**
 * «Регрессия» — a notebook component: every Playwright test of a folder run one after another, on the stand
 * chosen (an address swapped for another — dev → qa — in the tests' code at run time, not in the notes); a table
 * of the run, the runs kept by date, a test that passes and fails in turns marked unstable.
 */
export interface RegressCfg {
  /** Its own id: its runs are kept under it (the block's line moves as the note is edited). */
  id?: string
  /** The folder of the vault ('' — the whole vault). */
  folder: string
  /** Its subfolders too. */
  deep: boolean
  /** The stand: this address in the tests… */
  from?: string
  /** …becomes this one for the run. */
  to?: string
}
export type RegressState = 'ok' | 'fail' | 'skip'
/** A test's ready checks: how many of each verdict. */
export type CheckTally = Record<QaMark, number>
/** A test's ready checks counted by verdict (others — not counted). */
export function tallyChecks(checks: ReadonlyArray<{ state: string }>): CheckTally {
  const tally = Object.fromEntries(QA_MARKS.map((s) => [s, 0])) as CheckTally
  for (const c of checks) if (Object.hasOwn(tally, c.state)) tally[c.state as keyof CheckTally]++
  return tally
}
export interface RegressItem {
  /** The note (vault path) and the block's run key in it. */
  note: string
  key: string
  /** The test's name (its block's name, else its first step). */
  name: string
  state: RegressState
  ms?: number
  error?: string
  /** The ready checks (qa.…): how many passed / failed / warned. */
  checks?: CheckTally
  /** «не останавливать»: an expected / unstable test — its failure does not fail the run. */
  soft?: boolean
}
export interface RegressRun {
  at: number
  ms: number
  /** The stand it ran on (the address swapped to), none — as written. */
  stand?: string
  items: RegressItem[]
  /** Stopped by hand before the end. */
  stopped?: boolean
}
/** How many runs are kept. */
export const REGRESS_KEEP = 30

export function parseRegress(src: string): RegressCfg {
  const body = src.split('\n').slice(1, -1).join('\n').trim()
  try {
    const j = JSON.parse(body || '{}') as Partial<RegressCfg>
    return { ...(j.id ? { id: String(j.id) } : {}), folder: String(j.folder ?? ''), deep: j.deep !== false, ...(j.from ? { from: String(j.from) } : {}), ...(j.to ? { to: String(j.to) } : {}) }
  } catch {
    return { folder: '', deep: true }
  }
}
export const regressMd = (c: RegressCfg) => `\`\`\`regress\n${JSON.stringify({ ...(c.id ? { id: c.id } : {}), folder: c.folder, deep: c.deep, ...(c.from ? { from: c.from } : {}), ...(c.to ? { to: c.to } : {}) }, null, 2)}\n\`\`\``

/** The test's code for the stand: the address swapped (a trailing slash no matter). */
export function swapStand(code: string, from?: string, to?: string): string {
  const a = (from ?? '').trim().replace(/\/+$/, '')
  const b = (to ?? '').trim().replace(/\/+$/, '')
  if (!a || !b || a === b) return code
  return code.split(a).join(b)
}

/** A test unstable: in its last runs (up to 5) it both passed and failed. */
export function unstable(history: RegressRun[], note: string, key: string): boolean {
  const states = history
    .slice(-5)
    .map((r) => r.items.find((i) => i.note === note && i.key === key)?.state)
    .filter((s): s is 'ok' | 'fail' => s === 'ok' || s === 'fail')
  return states.includes('ok') && states.includes('fail')
}
/** A run in numbers: passed, failed (not «soft» ones), soft failed, all. */
export function runSum(r: RegressRun): { ok: number; fail: number; soft: number; all: number } {
  const ok = r.items.filter((i) => i.state === 'ok').length
  const fail = r.items.filter((i) => i.state === 'fail' && !i.soft).length
  const soft = r.items.filter((i) => i.state === 'fail' && i.soft).length
  return { ok, fail, soft, all: r.items.length }
}
