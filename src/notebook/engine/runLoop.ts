import { toRaw } from 'vue'
import { pauseMs, type LoopRange, type LoopResult } from '../domain/loop'
import { jsonClone } from '../domain/values'
import { errorText, runApi } from './runApi'
import { followEmits } from './runEmits'
import { PassEnv, type RunEnv } from './runEnv'
import { itemError, itemIsSoft, itemName, libsOf, loopHasPw, runItemsIn, type RunItem } from './runItems'
import { noteRun, saveRunsSoon } from './runStore'
import type { LoopRun, PassRun } from './runTypes'

/**
 * A loop run: its head (plain JS, in a process of its own) asks for passes — each runs the loop's blocks with the
 * values given, in order; the first failing one (not «soft») fails the pass. Afterwards each named block's name is
 * the list of its values over the passes, the loop's name — what its head returned, or its passes' records. A pause
 * (`pause=`) spaces the passes' starts; the loop's time limit counts it too.
 * (The same loop run again while it goes: the old run stopped and waited for first.)
 */

/** How the loop runs its items (given by the engine: a loop's items may be loops). */
export interface LoopChildren {
  runChild(item: RunItem, env: RunEnv, noteText: string): Promise<boolean>
  stopChild(item: RunItem, env: RunEnv): void
}

type PassHandler = (n: number, vars: Record<string, unknown>) => void
/** The loops going on: their run id → what takes their passes, what stops them, their end (to wait for). */
const passHandlers = new Map<string, PassHandler>()
const loopStops = new Map<string, () => void>()
const loopDone = new Map<string, Promise<boolean>>()
let listening = false
function listenToPasses(): void {
  if (listening) return
  listening = true
  runApi().onLoopPass((runId, n, vars) => passHandlers.get(runId)?.(n, vars))
}
/** How long the passes going on are waited for after the head ended (stopped, timed out) — then given up. */
const PASS_WAIT_MS = 30_000

/** A loop run in an env (its run id — the env's slot of the loop's key). */
export async function runLoop(loop: LoopRange, env: RunEnv, noteText: string, children: LoopChildren): Promise<boolean> {
  const runId = env.runSlot(loop.key)
  const prev = loopDone.get(runId)
  if (prev) {
    stopLoopRun(runId)
    await prev.catch(() => false)
  }
  const done = runLoopOnce(loop, env, noteText, runId, children)
  loopDone.set(runId, done)
  try {
    return await done
  } finally {
    if (loopDone.get(runId) === done) loopDone.delete(runId)
  }
}
/** A loop's run stopped by its id: its head killed, its passes' blocks stopped. */
export function stopLoopRun(runId: string): void {
  runApi().runLoopStop(runId)
  loopStops.get(runId)?.()
}

async function runLoopOnce(loop: LoopRange, env: RunEnv, noteText: string, runId: string, { runChild, stopChild }: LoopChildren): Promise<boolean> {
  listenToPasses()
  const n = noteRun(env.notePath)
  const items = runItemsIn(noteText, loop)
  // (a Playwright block's files are the block's own — anywhere in the loop: such a loop goes pass by pass)
  const serial = loop.info.parallel <= 1 || loopHasPw(noteText, loop)
  env.loops[loop.key] = { state: 'run', at: Date.now(), passes: [] }
  const lr = env.loops[loop.key]
  // seen on the note's blocks: the latest of a loop inside a loop too
  if (env.loops !== n.loops) n.loops[loop.key] = lr
  // the inner blocks' names: last run's lists gone — a pass sees its own values, never an old list by that name
  if (!env.id) for (const k of items.map(itemName)) if (k) delete n.ctx[k]
  let stopped = false
  const passEnvs = new Map<number, RunEnv>()
  /** The pauses being waited out (a stop ends them at once). */
  const naps = new Set<() => void>()
  const nap = (ms: number) =>
    new Promise<void>((done) => {
      const wake = () => (clearTimeout(t), naps.delete(wake), done())
      const t = setTimeout(wake, ms)
      naps.add(wake)
    })
  /** The passes' starts, spaced by the loop's pause (the first at once; parallel ones one pause after another). */
  let started: Promise<void> | undefined
  const turnToStart = (): Promise<void> => {
    const pause = loop.info.pause
    if (!pause) return Promise.resolve()
    started = started ? started.then(() => (stopped ? undefined : nap(pauseMs(pause)))) : Promise.resolve()
    return started
  }
  const stop = () => {
    stopped = true
    for (const wake of [...naps]) wake()
    for (const pe of passEnvs.values()) for (const x of items) stopChild(x, pe)
  }
  loopStops.set(runId, stop)
  const handler: PassHandler = (pn, vars) => {
    const pass: PassRun = { n: pn, vars, state: 'run', at: Date.now(), values: {}, runs: {}, loops: {} }
    // (in the order of their numbers — parallel ones may come in another)
    let at = lr.passes.length
    while (at > 0 && lr.passes[at - 1].n > pn) at--
    lr.passes.splice(at, 0, pass)
    const p = lr.passes[at]
    const pe = new PassEnv(env, loop.key, p, serial, lr)
    passEnvs.set(pn, pe)
    void runPass(p, pe)
  }
  /** A pass's items, in order; always ends by answering the head (a loop never waits for a pass that is gone). */
  async function runPass(p: PassRun, pe: RunEnv): Promise<void> {
    let t0 = performance.now()
    let error: string | undefined
    try {
      await turnToStart()
      // (the pause is not the pass's own time)
      t0 = performance.now()
      for (const x of items) {
        if (stopped) {
          error = 'Остановлено'
          break
        }
        const ok = await runChild(x, pe, noteText)
        if (!ok && !itemIsSoft(x)) {
          error = `${x.kind === 'loop' ? 'цикл' : 'блок'} «${x.key}»: ${itemError(x, pe).split('\n')[0]}`
          break
        }
      }
    } catch (e) {
      error = errorText(e)
    } finally {
      p.state = error ? 'error' : 'ok'
      p.error = error
      p.ms = performance.now() - t0
      passEnvs.delete(p.n)
      // the note's blocks show the latest pass (unless another one was picked to look at)
      if (lr.sel === undefined) showPass(env.notePath, lr, undefined)
      saveRunsSoon(env.notePath)
      let values: Record<string, unknown> = {}
      try {
        values = jsonClone(toRaw(p.values))
      } catch {
        // (nothing to give back — the head gets an empty object)
      }
      runApi().runLoopPass(runId, p.n, error ? { ok: false, error } : { ok: true, values })
    }
  }
  passHandlers.set(runId, handler)
  const gather = followEmits(runId, env, 'loop', loop.key, loop.info.keep)
  let res: LoopResult
  try {
    res = await runApi().runLoop(runId, {
      head: loop.head,
      ts: loop.ts,
      libs: libsOf(noteText, ''),
      ctx: jsonClone(env.values()),
      parallel: serial ? 1 : loop.info.parallel,
      max: loop.info.max,
      timeoutSec: loop.info.timeout,
    })
  } catch (e) {
    res = { ok: false, error: errorText(e), logs: [], passes: 0, ms: 0 }
  }
  // (stopped / timed out — the passes going on are stopped too, and waited for a while)
  if (!res.ok) stop()
  const until = Date.now() + PASS_WAIT_MS
  while (lr.passes.some((p) => p.state === 'run') && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
  for (const p of lr.passes) if (p.state === 'run') Object.assign(p, { state: 'error', error: 'Не дождались — остановлено' })
  const lost = await gather.end(res.emits, res.ok)
  if (lost && res.ok) res = { ...res, ok: false, error: lost }
  if (passHandlers.get(runId) === handler) passHandlers.delete(runId)
  if (loopStops.get(runId) === stop) loopStops.delete(runId)
  publishLoopResults(loop, env, items, lr, res)
  Object.assign(lr, { state: res.ok ? 'ok' : 'error', ms: res.ms, error: res.error, logs: res.logs, value: res.value, hasValue: res.hasValue })
  saveRunsSoon(env.notePath)
  return res.ok
}
/** After the loop: each inner name — its values over the passes (null where a pass gave none); set() of the head; the loop's own name. */
function publishLoopResults(loop: LoopRange, env: RunEnv, items: RunItem[], lr: LoopRun, res: LoopResult): void {
  for (const x of items) {
    const name = itemName(x)
    if (name) env.publish(name, lr.passes.map((p) => p.values[name] ?? null), x.kind, x.key)
  }
  for (const [k, v] of Object.entries(res.sets ?? {})) env.publish(k, v, 'set', loop.key)
  if (loop.info.name) env.publish(loop.info.name, res.ok && res.hasValue ? res.value : lr.passes.map((p) => ({ n: p.n, ...p.vars, ...toRaw(p.values), ...(p.error ? { error: p.error } : {}) })), 'loop', loop.key)
}

/**
 * A pass picked to look at (none — the latest): the loop's blocks show its runs — and only its (a block that did not
 * run in it shows nothing, not another pass's result).
 */
export function showPass(path: string, lr: LoopRun, index: number | undefined): void {
  const n = noteRun(path)
  const p = lr.passes[index ?? lr.passes.length - 1]
  if (!p) return
  const keys = new Set(lr.passes.flatMap((x) => Object.keys(x.runs ?? {})))
  for (const k of keys) {
    const r = p.runs?.[k]
    if (r) n.runs[k] = r
    else delete n.runs[k]
  }
  for (const [k, l] of Object.entries(p.loops ?? {})) n.loops[k] = l
}
/** A pass of a loop picked to look at (the last or beyond — the latest, following new passes). */
export function pickPass(path: string, key: string, index: number | undefined): void {
  const lr = noteRun(path).loops[key]
  if (!lr) return
  lr.sel = index === undefined || index >= lr.passes.length - 1 ? undefined : Math.max(0, index)
  showPass(path, lr, lr.sel)
  saveRunsSoon(path)
}
