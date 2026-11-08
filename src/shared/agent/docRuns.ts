import type { RunTrigger } from '../cronJobs'

/**
 * The document's journal of runs: who started which block (a person by hand, an AI agent's tool, a harness check, a
 * schedule), when, how long it went, how it ended, whether it waited for a person's input on the way. Kept beside the
 * AI's turns (docAi) — what the people see of the work done in the document.
 */

/** Who started a run. */
export const RUN_WHO_KINDS = ['person', 'ai', 'harness', 'cron'] as const
export type RunWhoKind = (typeof RUN_WHO_KINDS)[number]
export interface RunWho {
  kind: RunWhoKind
  /** The person's or the agent's name, the schedule's title; a harness check — «проверка harness». */
  name: string
}
export const DOC_RUN_OUTCOMES = ['ok', 'error'] as const
export type DocRunOutcome = (typeof DOC_RUN_OUTCOMES)[number]
export interface DocRun {
  id: string
  at: number
  ms: number
  who: RunWho
  /** The block as a person reads it: its kind's title and name («Оболочка «logs»»); its line (1-based). */
  block: string
  line: number
  /** Part of «Выполнить всё». */
  all?: boolean
  outcome: DocRunOutcome
  error?: string
  /** It waited for a person's input on the way (a password a terminal asked for). */
  waited?: boolean
}

/** The journal keeps this many runs (the oldest go). */
export const DOC_RUNS_MAX = 100
const ERROR_MAX = 300

/** Who a run's trigger names (a person by hand — `person`, the one at this app). */
export function runWhoOf(t: RunTrigger | undefined, person: string): RunWho {
  if (!t || t.by === 'hand') return { kind: 'person', name: t?.who || person }
  if (t.by === 'cron') return { kind: 'cron', name: t.cron?.title ?? 'расписание' }
  if (t.harness) return { kind: 'harness', name: t.who ? `проверка harness · ${t.who}` : 'проверка harness' }
  return { kind: 'ai', name: t.who || 'ИИ' }
}

/** A run as the journal keeps it (its error's first lines, within a limit). */
export function docRunOf(o: { at: number; ms: number; who: RunWho; block: string; line: number; all?: boolean; ok: boolean; error?: string; waited?: boolean }): DocRun {
  return {
    id: `${o.at}-${o.line}-${Math.random().toString(36).slice(2, 7)}`,
    at: o.at,
    ms: Math.max(0, Math.round(o.ms)),
    who: o.who,
    block: o.block,
    line: o.line,
    ...(o.all ? { all: true } : {}),
    outcome: o.ok ? 'ok' : 'error',
    ...(!o.ok && o.error ? { error: o.error.slice(0, ERROR_MAX) } : {}),
    ...(o.waited ? { waited: true } : {}),
  }
}

/** The journal with a run put in (once): the latest DOC_RUNS_MAX. */
export const withRun = (runs: readonly DocRun[], r: DocRun): DocRun[] => [...runs.filter((x) => x.id !== r.id), r].slice(-DOC_RUNS_MAX)

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const isWho = (x: unknown): x is RunWho => isObj(x) && (RUN_WHO_KINDS as readonly unknown[]).includes(x.kind) && typeof x.name === 'string'
export const isDocRun = (x: unknown): x is DocRun =>
  isObj(x) && typeof x.id === 'string' && typeof x.at === 'number' && typeof x.ms === 'number' && isWho(x.who) && typeof x.block === 'string' && typeof x.line === 'number' && (DOC_RUN_OUTCOMES as readonly unknown[]).includes(x.outcome)
/** The runs another app (or an older one) wrote, read safely: the malformed ones left out. */
export const docRunsOf = (x: unknown): DocRun[] => (Array.isArray(x) ? x.filter(isDocRun).slice(-DOC_RUNS_MAX) : [])
