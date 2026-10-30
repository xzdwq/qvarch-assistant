/**
 * Values gathered as a run goes (a stream, a scenario's steps, a loop's passes): code, a Playwright scenario and a
 * loop's head put parts into a variable of the note — `emit(name, x)` a list, `emit.text(name, s)` one text,
 * `emit.merge(name, {…})` one object — and the note sees it grow while the run goes. The parts go in numbered
 * batches (a process → main → the window, in order); the window adds them in their order, never twice, and says so
 * when one is missing. `keep=N` (a block's, a loop's) — the variable goes on from the last run (its last N items /
 * lines), else every run starts it anew.
 */

/** How a variable gathers its parts: a list, one text, one object. */
export const EMIT_MODES = ['append', 'text', 'merge'] as const
export type EmitMode = (typeof EMIT_MODES)[number]

export interface EmitPart {
  name: string
  mode: EmitMode
  value: unknown
}
/** Parts sent together; `seq` — 1, 2, 3… within a run. */
export interface EmitBatch {
  seq: number
  parts: EmitPart[]
}

/** A batch goes when this old (ms) or this big (characters as JSON). */
export const EMIT_FLUSH_MS = 50
export const EMIT_BATCH_SIZE = 64 * 1024
/** A variable gathers at most this much (characters as JSON) in one run — more is an error, never cut silently. */
export const EMIT_VAR_MAX = 16 * 1024 * 1024
/** keep=N — at most. */
export const EMIT_KEEP_MAX = 100_000
/** keep=N read: a positive whole number, capped; anything else — none. */
export const keepOf = (v: string): number | undefined => {
  const n = Math.floor(Number(v))
  return n >= 1 ? Math.min(EMIT_KEEP_MAX, n) : undefined
}

/** The empty value of a mode. */
const EMPTY: Record<EmitMode, () => unknown> = {
  append: () => [],
  text: () => '',
  merge: () => ({}),
}
/** A value fits a mode (a list, a text, an object) — what is carried over from the last run. */
const FITS: Record<EmitMode, (v: unknown) => boolean> = {
  append: (v) => Array.isArray(v),
  text: (v) => typeof v === 'string',
  merge: (v) => !!v && typeof v === 'object' && !Array.isArray(v),
}
/** The last `keep` of a value: a list's items, a text's lines (an object — whole). */
const TRIM: Record<EmitMode, (v: unknown, keep: number) => unknown> = {
  append: (v, keep) => (v as unknown[]).slice(-keep),
  text: (v, keep) => (v as string).split('\n').slice(-keep).join('\n'),
  merge: (v) => ({ ...(v as object) }),
}
/** A variable's value at a run's start: anew, or (keep=N) the last run's — its last N — when it fits the mode. */
export function startValue(mode: EmitMode, prev: unknown, keep?: number): unknown {
  return keep && FITS[mode](prev) ? TRIM[mode](prev, keep) : EMPTY[mode]()
}
/** A part added: a list grows in place, a text — a longer one, an object — its keys over the old ones. */
const ADD: Record<EmitMode, (acc: unknown, v: unknown) => unknown> = {
  append: (acc, v) => ((acc as unknown[]).push(v), acc),
  text: (acc, v) => (acc as string) + (typeof v === 'string' ? v : String(v)),
  merge: (acc, v) => Object.assign(acc as object, v),
}
export const addPart = (acc: unknown, mode: EmitMode, v: unknown): unknown => ADD[mode](acc, v)
/** After the parts of a run with keep=N: no more than N (a list's items, a text's lines). */
export const keptOf = (v: unknown, mode: EmitMode, keep: number | undefined): unknown => (keep ? TRIM[mode](v, keep) : v)

/**
 * The batches put in their order: a batch that came early waits for the ones before it (they never come twice).
 * `ready` — the ones that may be added now, in order.
 */
export class BatchOrder {
  private next = 1
  private readonly early = new Map<number, EmitBatch>()
  push(b: EmitBatch): EmitBatch[] {
    if (b.seq < this.next || this.early.has(b.seq)) return []
    this.early.set(b.seq, b)
    const ready: EmitBatch[] = []
    for (let x = this.early.get(this.next); x; x = this.early.get(this.next)) {
      this.early.delete(this.next++)
      ready.push(x)
    }
    return ready
  }
  /** The last batch added (all before it — added). */
  get done(): number {
    return this.next - 1
  }
}
