import type { BlockInfo } from '../domain/blockInfo'
import type { SqlMode } from '../../shared/sql'
import type { RunEnv } from './runEnv'
import type { BlockItem } from './runItems'
import type { BlockRun } from './runTypes'

/**
 * A runnable kind's runner (blocks/<kind>/run.ts): how a block of the kind runs in an env, how it is stopped, what
 * its run gives, how its run reads in a report. The engine finds it in BLOCK_RUNNERS by the block's kind.
 */
export interface BlockRunRequest {
  env: RunEnv
  item: BlockItem
  /** The whole note (the shared functions, the other blocks' runs). */
  noteText: string
  /** A query: run it, or show its plan (with or without running it). */
  sqlMode?: SqlMode
  /** Values of its check to run anew though remembered (a matrix's — by their labels or values). */
  recheck?: string[]
}

export interface ReportContext {
  info: BlockInfo
  body: string
  /** The short form: no bodies, no logs (a block that went well in a note's report). */
  brief: boolean
}

export interface BlockRunner {
  /** Runs the block: its run recorded in the env, its result published; false — it failed (or a newer run took over). */
  run(req: BlockRunRequest): Promise<boolean>
  /** Stops the block's run going on in the env (nothing going on — nothing happens). */
  stop(env: RunEnv, key: string): void
  /** The value a run gave — what the block publishes under its name (an unnamed block in a loop's pass). */
  resultOf(run: BlockRun): unknown
  /** The report's head line after «— »: how it went (a status, rows, «выполнен»…) and its time. */
  reportHeadline(run: BlockRun, ctx: ReportContext): string
  /** The report's lines under the head line (what was sent, the steps…), before the error. */
  reportDetails?(run: BlockRun, ctx: ReportContext): string[]
  /** The report's lines after the result (what the run left: a trace, a screenshot). */
  reportExtras?(run: BlockRun): string[]
  /** A row of a loop's «Вместе» table from a pass's result (none — the value's own fields). */
  loopRow?(value: unknown): Record<string, unknown>
}
