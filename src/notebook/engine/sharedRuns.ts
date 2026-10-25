import { RESULT_KINDS, resultKindOf, type ResultKind } from '../../shared/transport/results'
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

/** A query's / a form's secret parameters (`?token=…`, `password=…`): their values hidden. */
export const hideInQuery = (s: string) => s.replace(/([?&;]|^)([^=&?#;\s]+)=([^&#;\s]*)/g, (all, sep: string, k: string) => (SECRET_HEADER.test(decodeKey(k)) ? `${sep}${k}=${HIDDEN}` : all))
const decodeKey = (k: string) => {
  try {
    return decodeURIComponent(k)
  } catch {
    return k
  }
}
/** A JSON's secret fields (any depth) hidden. */
function hideFields(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(hideFields)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_HEADER.test(k) && (typeof x === 'string' || typeof x === 'number') ? HIDDEN : hideFields(x)]))
}
/** A request's / an answer's body with its secrets hidden: a JSON's fields (laid out as it was), a form's parameters. */
export function hideInBody(body: string): string {
  const t = body.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.stringify(hideFields(JSON.parse(t)), null, t.includes('\n') ? 2 : undefined)
    } catch {
      // not JSON after all: as text
    }
  }
  return /^[^\s=&]+=[^\s]*(&[^\s=&]+=[^\s]*)*$/.test(t) ? hideInQuery(t) : body
}
/** A block's run as the others get it: the secret headers, query parameters and body fields hidden. */
export function scrubRun(r: BlockRun): BlockRun {
  return {
    ...r,
    ...(r.request ? { request: { ...r.request, url: hideInQuery(r.request.url), body: hideInBody(r.request.body), headers: hideHeaders(r.request.headers)! } } : {}),
    ...(r.response ? { response: { ...r.response, url: hideInQuery(r.response.url), body: hideInBody(r.response.body), headers: hideHeaders(r.response.headers)! } } : {}),
  }
}
/** Each kind of entry: where it is in a note's runs, its secrets taken off. */
const KINDS = {
  run: { of: (n: NoteRun) => n.runs, out: (v: BlockRun) => scrubRun(v), ended: (v: BlockRun) => v.state !== 'run' },
  loop: { of: (n: NoteRun) => n.loops, out: (v: LoopRun) => v, ended: (v: LoopRun) => v.state !== 'run' },
  ctx: { of: (n: NoteRun) => n.ctx, out: (v: CtxItem) => v, ended: () => true },
} as const satisfies Record<ResultKind, unknown>
const kindOf = resultKindOf

/** This device's results in a note now, by entry (still running ones and the others' left out). */
export function runEntries(n: NoteRun): RunEntries {
  const out: RunEntries = {}
  for (const kind of RESULT_KINDS) {
    const k = KINDS[kind] as { of: (n: NoteRun) => Record<string, { at: number; by?: string }>; out: (v: never) => unknown; ended: (v: never) => boolean }
    for (const [key, v] of Object.entries(k.of(n))) if (!v.by && k.ended(v as never)) out[`${kind}:${key}`] = { at: v.at, value: k.out(v as never) }
  }
  return out
}
/** The note's own entry by its key (none — not there, or a key of no kind). */
export function localEntry(n: NoteRun, key: string): { at: number; state?: string; by?: string } | undefined {
  const kind = kindOf(key)
  return kind ? (KINDS[kind].of(n) as Record<string, { at: number; state?: string; by?: string }>)[key.slice(kind.length + 1)] : undefined
}
/**
 * An entry put into a note's runs as the server has it — someone else's marked with who ran it (`by`), one's own
 * without; null — taken away. Whether it goes in is the server's order's to say (resultSync). Returns whether it changed.
 */
export function putEntry(n: NoteRun, key: string, value: unknown, by?: string): boolean {
  const kind = kindOf(key)
  if (!kind) return false
  const into = KINDS[kind].of(n) as Record<string, unknown>
  const name = key.slice(kind.length + 1)
  if (value === null || value === undefined) {
    if (!(name in into)) return false
    delete into[name]
    return true
  }
  into[name] = by ? { ...(value as object), by } : value
  return true
}
