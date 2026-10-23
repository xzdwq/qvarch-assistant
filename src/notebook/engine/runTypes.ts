import type { PwStep } from '../../shared/api'
import type { HttpResponse } from '../../shared/http'
import type { QaCheck } from '../../shared/qaChecks'
import type { SqlMode, SqlResult } from '../../shared/sql'
import type { Plan } from '../../shared/sqlPlan'
import type { ValueSource } from '../domain/blockInfo'

/**
 * A runnable note's run: its context (the values the blocks published, by name) and each block's last run
 * (state, time, the request and the answer, the logs). Kept next to the note (vault/.runs) — reopened, the
 * note shows its last results; a new run replaces them.
 */
export type RunState = 'run' | 'ok' | 'error'
export type Log = { level: 'log' | 'info' | 'warn' | 'error'; text: string }

/** A value of the note's context and where it came from. */
export interface CtxItem {
  value: unknown
  at: number
  from: ValueSource
  /** The block that published it. */
  block: string
}
/** A block's last run (the fields a kind fills — the others stay empty). */
export interface BlockRun {
  state: RunState
  at: number
  ms?: number
  error?: string
  logs?: Log[]
  /** A request block: what was sent (the templates filled) and what came. */
  request?: { method: string; url: string; headers: Array<[string, string]>; body: string; missing: string[] }
  response?: HttpResponse
  /** A code block: what it returned. */
  value?: unknown
  hasValue?: boolean
  /** A Playwright block: its steps, what it left (final.png / failure.png, trace.zip, allure-results), the browser. */
  steps?: PwStep[]
  /** The ready checks of a Playwright block (qa.…). */
  checks?: QaCheck[]
  files?: string[]
  browser?: string
  /** A database query: what was sent (the note's values as parameters), its rows, its plan, the server. */
  sql?: { text: string; values: unknown[]; mode: SqlMode; db: string; missing: string[] }
  table?: SqlResult
  plan?: Plan
  planRaw?: string
  server?: string
}
/** A loop's pass: the values it was given, what its blocks published, their runs (the loops inside it — theirs). */
export interface PassRun {
  n: number
  vars: Record<string, unknown>
  state: RunState
  at: number
  ms?: number
  error?: string
  /** What its blocks published (by name; set() too). */
  values: Record<string, unknown>
  /** Its blocks' runs (an old pass of a long loop keeps its values only). */
  runs?: Record<string, BlockRun>
  loops?: Record<string, LoopRun>
}
export interface LoopRun {
  state: RunState
  at: number
  ms?: number
  error?: string
  logs?: Log[]
  /** What its head returned. */
  value?: unknown
  hasValue?: boolean
  passes: PassRun[]
  /** The pass shown (its index; none — the last). */
  sel?: number
  /** Passes whose runs were let go (their values kept) — the note's runs file stays small. */
  trimmed?: number
}
/** Everything run in a note: its context, its blocks' and loops' runs, «Выполнить всё» going on. */
export interface NoteRun {
  ctx: Record<string, CtxItem>
  runs: Record<string, BlockRun>
  /** The loops' runs (the latest of a loop inside a loop). */
  loops: Record<string, LoopRun>
  loaded: boolean
  /** «Выполнить всё» going on: the block being run. */
  all?: { at: string; done: number; total: number; error?: string }
}
