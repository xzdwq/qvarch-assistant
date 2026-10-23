import type { SqlMode } from '../../shared/sql'
import { errorText } from './runApi'
import type { RunEnv } from './runEnv'
import type { RunItem } from './runItems'
import { runLoop, stopLoopRun } from './runLoop'
import { BLOCK_RUNNERS } from './runners'
import { saveRunsSoon } from './runStore'

/**
 * One thing run in its env: a block by its kind's runner, a loop with all its passes. What is thrown before a run
 * begins (a broken request text, no connections list…) becomes the item's error — a run never throws.
 */
export async function runItem(item: RunItem, env: RunEnv, noteText: string, opts: { sqlMode?: SqlMode } = {}): Promise<boolean> {
  try {
    switch (item.kind) {
      case 'loop':
        return await runLoop(item.loop, env, noteText, { runChild: runItem, stopChild: stopItem })
      default:
        return await BLOCK_RUNNERS[item.kind].run({ env, item, noteText, sqlMode: opts.sqlMode })
    }
  } catch (e) {
    recordItemError(item, env, errorText(e))
    saveRunsSoon(env.notePath)
    return false
  }
}
/** An item's run going on in an env stopped (a loop — its head and its passes' blocks). */
export function stopItem(item: RunItem, env: RunEnv): void {
  switch (item.kind) {
    case 'loop':
      return stopLoopRun(env.runSlot(item.key))
    default:
      return BLOCK_RUNNERS[item.kind].stop(env, item.key)
  }
}
function recordItemError(item: RunItem, env: RunEnv, error: string): void {
  switch (item.kind) {
    case 'loop':
      Object.assign((env.loops[item.key] ??= { state: 'error', at: Date.now(), passes: [] }), { state: 'error', error })
      return
    default:
      env.recordRun(item.key, { state: 'error', at: Date.now(), error })
  }
}
