import type { ValueSource } from '../domain/blockInfo'
import { errorText } from './runApi'
import { followEmits } from './runEmits'
import type { RunEnv } from './runEnv'
import type { BlockItem } from './runItems'
import { saveRunsSoon } from './runStore'
import type { BlockRun, Log } from './runTypes'

/**
 * How a runner runs a block whose answer is awaited (a request, a query, code, a browser test): one way for all —
 * recorded as going, the answer recorded and published only while it is the block's latest run, saved.
 */

/**
 * The latest run of each slot (a block in an env): a run started again before the first answered — the first one's
 * answer is dropped.
 */
export class LatestRuns {
  private readonly bySlot = new Map<string, string>()
  private lastStamp = 0
  /** A new run of the slot: its id (the slot and the time — never the same twice, two runs in one millisecond too). */
  begin(slot: string): string {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1)
    const id = `${slot}#${this.lastStamp}`
    this.bySlot.set(slot, id)
    return id
  }
  /** The run is still the slot's latest one. */
  isLatest(slot: string, id: string): boolean {
    return this.bySlot.get(slot) === id
  }
  /** The slot's run going on (its id), if any. */
  current(slot: string): string | undefined {
    return this.bySlot.get(slot)
  }
  /** The run ended (a newer one, if any, stays). */
  end(slot: string, id: string): void {
    if (this.bySlot.get(slot) === id) this.bySlot.delete(slot)
  }
}

/** What a run's answer gave: whether it went well, its run's fields, what it publishes. */
export interface RunAnswer {
  ok: boolean
  run: Partial<BlockRun>
  publish?: () => void
}
/**
 * The ids of a run: its own (`runId` — a request or a query is awaited and aborted by it) and its block's slot in
 * the env (a process the main side restarts by it: code, a browser test).
 */
export interface RunIds {
  runId: string
  slot: string
}

/**
 * A block's run: recorded as going; its answer recorded over it and published — unless a newer run of the block took
 * over meanwhile (then dropped: never written over the newer one's); a throw — its error. Saved either way.
 */
export async function trackedRun(latest: LatestRuns, env: RunEnv, key: string, going: BlockRun, ask: (ids: RunIds) => Promise<RunAnswer>): Promise<boolean> {
  const slot = env.runSlot(key)
  const runId = latest.begin(slot)
  const r = env.recordRun(key, going)
  try {
    const a = await ask({ runId, slot })
    if (!latest.isLatest(slot, runId)) return false
    env.recordRun(key, { ...r, ...a.run, state: a.ok ? 'ok' : 'error' })
    a.publish?.()
    return a.ok
  } catch (e) {
    if (!latest.isLatest(slot, runId)) return false
    env.recordRun(key, { ...r, state: 'error', error: errorText(e) })
    return false
  } finally {
    latest.end(slot, runId)
    saveRunsSoon(env.notePath)
  }
}

/** What a process run answers (code, a browser test). */
interface ProcessResult {
  ok: boolean
  ms: number
  logs: Log[]
  error?: string
  value?: unknown
  hasValue?: boolean
  sets?: Record<string, unknown>
  /** The emit() batches it sent. */
  emits?: number
}

/**
 * A block run in a process of its own (code, a browser test): its emit() batches gathered as they come (by its slot),
 * waited for at its end; its value (it went well, the block named) and its set() published as `from`.
 */
export async function processRun<R extends ProcessResult>(slot: string, env: RunEnv, item: BlockItem, from: ValueSource, call: () => Promise<R>, fields: (r: R) => Partial<BlockRun> = () => ({})): Promise<RunAnswer> {
  const gather = followEmits(slot, env, from, item.key, item.info.keep)
  let r: R
  try {
    r = await call()
  } catch (e) {
    await gather.end(undefined, false)
    throw e
  }
  const lost = await gather.end(r.emits, r.ok)
  const ok = r.ok && !lost
  return {
    ok,
    run: { ms: r.ms, logs: r.logs, error: r.error ?? lost, value: r.value, hasValue: r.hasValue, ...fields(r) },
    publish() {
      if (ok && item.info.name && r.hasValue) env.publish(item.info.name, r.value, from, item.key)
      for (const [k, v] of Object.entries(r.sets ?? {})) env.publish(k, v, 'set', item.key)
    },
  }
}
