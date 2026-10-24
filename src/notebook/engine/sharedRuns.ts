import type { BlockRun, CtxItem, LoopRun, NoteRun } from './runTypes'

/**
 * A shared note's run results as entries the others get: each block's last run (`run:<key>`), each loop's
 * (`loop:<key>`), each published value (`ctx:<name>`). A run going on is not an entry yet (it is sent once it ends).
 * What goes out has its secrets taken off (the request's and the answer's authorization, cookies, tokens).
 */
export interface RunEntry {
  at: number
  value: unknown
}
export type RunEntries = Record<string, RunEntry>

/** Headers that carry secrets (their values are not sent). */
const SECRET_HEADER = /authorization|cookie|token|api[-_]?key|secret|password|session/i
export const HIDDEN = '•••'
const hideHeaders = (hs: Array<[string, string]> | undefined) => hs?.map(([k, v]): [string, string] => [k, SECRET_HEADER.test(k) ? HIDDEN : v])

/** A block's run as the others get it: the secret headers hidden. */
export function scrubRun(r: BlockRun): BlockRun {
  return {
    ...r,
    ...(r.request ? { request: { ...r.request, headers: hideHeaders(r.request.headers)! } } : {}),
    ...(r.response ? { response: { ...r.response, headers: hideHeaders(r.response.headers)! } } : {}),
  }
}
/** Each kind of entry: where it is in a note's runs, its secrets taken off. */
const KINDS = {
  run: { of: (n: NoteRun) => n.runs, out: (v: BlockRun) => scrubRun(v), ended: (v: BlockRun) => v.state !== 'run' },
  loop: { of: (n: NoteRun) => n.loops, out: (v: LoopRun) => v, ended: (v: LoopRun) => v.state !== 'run' },
  ctx: { of: (n: NoteRun) => n.ctx, out: (v: CtxItem) => v, ended: () => true },
} as const
type Kind = keyof typeof KINDS
const kindOf = (key: string): Kind | undefined => {
  const k = key.slice(0, key.indexOf(':'))
  return Object.hasOwn(KINDS, k) ? (k as Kind) : undefined
}

/** This device's results in a note now, by entry (still running ones and the others' left out). */
export function runEntries(n: NoteRun): RunEntries {
  const out: RunEntries = {}
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const k = KINDS[kind] as { of: (n: NoteRun) => Record<string, { at: number; by?: string }>; out: (v: never) => unknown; ended: (v: never) => boolean }
    for (const [key, v] of Object.entries(k.of(n))) if (!v.by && k.ended(v as never)) out[`${kind}:${key}`] = { at: v.at, value: k.out(v as never) }
  }
  return out
}
/** What changed since what was sent (each entry's JSON): the changed ones, the gone ones — null. */
export function entriesToSend(sent: ReadonlyMap<string, string>, now: RunEntries): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, e] of Object.entries(now)) if (sent.get(key) !== JSON.stringify(e.value)) out[key] = e.value
  for (const key of sent.keys()) if (!(key in now)) out[key] = null
  return out
}
/**
 * Someone's entry put into a note's runs (who ran it marked). A newer one of this device's own (run meanwhile) stays;
 * a running one stays (its end will be sent). Returns whether it changed anything.
 */
export function applyEntry(n: NoteRun, key: string, value: unknown, by: string): boolean {
  const kind = kindOf(key)
  if (!kind) return false
  const into = KINDS[kind].of(n) as Record<string, { at: number; state?: string; by?: string }>
  const name = key.slice(kind.length + 1)
  const mine = into[name]
  if (value === null || value === undefined) {
    if (!mine) return false
    delete into[name]
    return true
  }
  const theirs = value as { at: number }
  if (mine && (mine.state === 'run' || mine.at > theirs.at)) return false
  into[name] = { ...theirs, by }
  return true
}
