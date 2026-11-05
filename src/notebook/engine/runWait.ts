import { watch } from 'vue'
import { loadedNoteRun } from './runStore'
import type { BlockRun, LoopRun, NoteRun } from './runTypes'

/**
 * A note's runs going on here and waiting for them to end: what reads a note's results while it runs (the AI's
 * note_results beside its own note_run) gets them as they end, not «выполняется» over and over.
 */
const ownGoing = (r: { state: string; by?: string }) => r.state === 'run' && !r.by
const blocksGoing = (runs: Record<string, BlockRun> | undefined) => Object.values(runs ?? {}).some(ownGoing)
function loopGoing(l: LoopRun): boolean {
  return ownGoing(l) || l.passes.some((p) => p.state === 'run' || blocksGoing(p.runs) || Object.values(p.loops ?? {}).some(loopGoing))
}

/** Something of the note runs here now: a block, a loop or a pass of it, «Выполнить всё». (Someone else's run of a shared note — theirs to end.) */
export function noteRunsGoing(n: NoteRun | undefined): boolean {
  if (!n) return false
  return (!!n.all && !n.all.error) || blocksGoing(n.runs) || Object.values(n.loops).some(loopGoing)
}

/**
 * Resolves when nothing of the note runs here any more (at once — nothing does), or after `maxMs`: true — they
 * ended, false — still going then. Followed by the runs' own changes, not polled.
 */
export function noteRunsSettled(path: string, maxMs: number): Promise<boolean> {
  if (!noteRunsGoing(loadedNoteRun(path))) return Promise.resolve(true)
  return new Promise((done) => {
    const timer = setTimeout(() => finish(false), maxMs)
    const stop = watch(
      () => noteRunsGoing(loadedNoteRun(path)),
      (going) => !going && finish(true),
    )
    function finish(ended: boolean): void {
      clearTimeout(timer)
      stop()
      done(ended)
    }
  })
}
