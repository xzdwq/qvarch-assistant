import type { ValueSource } from '../domain/blockInfo'
import { addPart, BatchOrder, EMIT_FLUSH_MS, keptOf, startValue, type EmitBatch, type EmitMode } from '../domain/emits'
import { runApi } from './runApi'
import type { RunEnv } from './runEnv'
import { noteRun, publishGathered } from './runStore'

/**
 * What a run's emit() gathers, here: its numbered batches added in their order (one that came early waits, none is
 * added twice), every variable shown as it grows. The variables live as long as the run they are part of (a «Выполнить
 * всё», a loop's passes — all its blocks add to one); `keep=N` — one goes on from the last run's value. At the run's
 * end its batches are waited for — all it said it sent; one missing — said, never passed over in silence.
 */

/** A variable gathered in a run: how, what so far (it grows in place — never shown itself), when it was shown last. */
interface Gathered {
  mode: EmitMode
  value: unknown
  /** When it was shown last (performance.now()), how long its copy took then (ms); a show put off till then. */
  shownAt: number
  cost: number
  later?: ReturnType<typeof setTimeout>
}

/**
 * A gathered value as it is shown: a list / an object — a copy of its own (whatever shows it gets a new value: the
 * one it holds never changes under it, so it is seen to change), a text — as it is (a new one every time anyway).
 */
const COPY: Record<EmitMode, (v: unknown) => unknown> = {
  append: (v) => (v as unknown[]).slice(),
  text: (v) => v,
  merge: (v) => ({ ...(v as object) }),
}
/** The share of the time a copy may take: a big list is shown less often, the window never stalls on it. */
const SHOW_SHARE = 0.05
/**
 * A variable shown in the note: at most every EMIT_FLUSH_MS, and no more often than its copy's cost allows (a show
 * that comes too soon is put off — the latest one is always shown); `now` — at once (its run's end).
 */
function show(path: string, name: string, g: Gathered, from: ValueSource, block: string, o: { partial?: boolean; now?: boolean } = {}): void {
  clearTimeout(g.later)
  g.later = undefined
  const wait = Math.max(EMIT_FLUSH_MS, g.cost / SHOW_SHARE) - (performance.now() - g.shownAt)
  if (!o.now && wait > 0) {
    g.later = setTimeout(() => show(path, name, g, from, block), wait)
    return
  }
  const t0 = performance.now()
  const value = COPY[g.mode](g.value)
  g.shownAt = performance.now()
  g.cost = g.shownAt - t0
  publishGathered(path, name, value, from, block, !!o.partial)
}
/** The variables of each run (its root env), by name. */
const gathered = new WeakMap<RunEnv, Map<string, Gathered>>()
/** The runs whose batches are awaited: their run id → what takes a batch. */
const followers = new Map<string, (b: EmitBatch) => void>()
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  runApi().onRunEmit((runId, batch) => followers.get(runId)?.(batch))
}
/** How long the batches still on their way are waited for at a run's end (they are sent before it: a moment at most). */
const LATE_MS = 2000

export interface EmitFollow {
  /**
   * The run ended: its batches all in — `sent`, how many it said it sent (none — it ended without saying: stopped,
   * killed); `ok` — it went well (else its variables are marked partial). What went wrong with them, if anything.
   */
  end(sent: number | undefined, ok: boolean): Promise<string | undefined>
}

/** A block's (a loop's) run followed: its emit() parts into the note's variables, as `from` of `block`. */
export function followEmits(runId: string, env: RunEnv, from: ValueSource, block: string, keep?: number): EmitFollow {
  listen()
  const order = new BatchOrder()
  const vars = gathered.get(env.root) ?? gathered.set(env.root, new Map()).get(env.root)!
  const mine = new Set<string>()
  let clash: string | undefined
  const add = (b: EmitBatch) => {
    // (every batch ready now added first — one that came early with the one it waited for — then shown once)
    const grown = new Set<string>()
    for (const x of order.push(b)) {
      for (const p of x.parts) {
        let g = vars.get(p.name)
        if (!g) vars.set(p.name, (g = { mode: p.mode, value: startValue(p.mode, noteRun(env.notePath).ctx[p.name]?.value, keep), shownAt: -Infinity, cost: 0 }))
        // (two blocks of one run gathering one name two ways — the first way stays)
        if (g.mode !== p.mode) {
          clash ??= `«${p.name}» в этом запуске уже накапливается другим способом (${g.mode}) — часть ${p.mode} не добавлена`
          continue
        }
        g.value = addPart(g.value, p.mode, p.value)
        grown.add(p.name)
        mine.add(p.name)
      }
    }
    for (const name of grown) show(env.notePath, name, vars.get(name)!, from, block)
  }
  followers.set(runId, add)
  return {
    async end(sent, ok) {
      for (const until = Date.now() + LATE_MS; sent !== undefined && order.done < sent && Date.now() < until; ) await new Promise((r) => setTimeout(r, 10))
      if (followers.get(runId) === add) followers.delete(runId)
      const lost = sent !== undefined && order.done < sent ? `потеряны порции emit: дошло ${order.done} из ${sent}` : undefined
      for (const name of mine) {
        const g = vars.get(name)!
        g.value = keptOf(g.value, g.mode, keep)
        show(env.notePath, name, g, from, block, { partial: !ok || !!lost, now: true })
      }
      return lost ?? clash
    },
  }
}
