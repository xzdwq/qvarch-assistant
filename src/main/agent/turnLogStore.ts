import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { isTurnLogId, turnLogOf, TURN_LOGS_MAX, type TurnLog } from '../../shared/agent/turnLog'
import { readJsonFile, writeJsonQuietly } from '../fsAtomic'

/**
 * The turns' full records on this computer only (data/agent-turns/<turn>.json): what went to the model and what it
 * said, whole. The latest TURN_LOGS_MAX are kept.
 */
export class TurnLogStore {
  private readonly dir: string
  constructor(root: string) {
    this.dir = join(root, 'agent-turns')
  }

  /** A turn's record kept (the oldest beyond the limit removed). */
  save(log: TurnLog): void {
    const ok = turnLogOf(log)
    if (!ok) return
    mkdirSync(this.dir, { recursive: true })
    if (writeJsonQuietly(this.fileOf(ok.id), ok)) this.prune()
  }

  /** A turn's record (none — this computer did not run it, or it is long gone). */
  get(id: string): TurnLog | undefined {
    if (!isTurnLogId(id)) return undefined
    return turnLogOf(readJsonFile(this.fileOf(id)))
  }

  private fileOf = (id: string) => join(this.dir, `${id}.json`)

  private prune(): void {
    try {
      const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'))
      if (files.length <= TURN_LOGS_MAX) return
      const byAge = files.map((f) => ({ f, t: statSync(join(this.dir, f)).mtimeMs })).sort((a, b) => a.t - b.t)
      for (const { f } of byAge.slice(0, files.length - TURN_LOGS_MAX)) unlinkSync(join(this.dir, f))
    } catch (e) {
      // (a file locked for a moment: the next save tries again)
      console.error('[agent] could not prune turn logs', e)
    }
  }
}
