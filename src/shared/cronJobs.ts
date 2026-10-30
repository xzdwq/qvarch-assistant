import { describeCron, guessFormat, nextRuns } from './cron'

/**
 * Notes run on a schedule: a job — a note, a cron expression (crontab, or with seconds — Spring / Quartz), its name,
 * on or off — and the journal of its last runs (done, failed, skipped — the app was closed or the last one still
 * going). A run knows what started it (`trigger`): by hand, by the AI, by a schedule — its blocks and the AI see it.
 */

/** What started a note's run. */
export const RUN_TRIGGERS = ['hand', 'ai', 'cron'] as const
export type RunTriggerKind = (typeof RUN_TRIGGERS)[number]
export interface RunTrigger {
  by: RunTriggerKind
  /** When it started (ms). */
  at: number
  /** The schedule that started it. */
  cron?: { id: string; title: string; expr: string }
}

/** How a job's run went: done, failed, skipped (when it was due and could not run — why, in `error`). */
export const CRON_RUN_STATES = ['ok', 'error', 'missed'] as const
export type CronRunState = (typeof CRON_RUN_STATES)[number]
export interface CronRun {
  at: number
  state: CronRunState
  ms?: number
  /** What went wrong / why it was skipped (a failed block's error, «приложение было закрыто»). */
  error?: string
  /** Skipped: how many times it was due meanwhile. */
  count?: number
  /** Run now by hand (not by the schedule). */
  hand?: boolean
}
export interface CronJob {
  id: string
  /** The note (the notebook's path). */
  note: string
  expr: string
  /** Its name ('' — the note's). */
  title: string
  on: boolean
  created: number
  /** The latest runs, newest first. */
  runs: CronRun[]
}
/** The runs a job's journal keeps. */
export const CRON_RUNS_KEPT = 20
export const CRON_TITLE_MAX = 120

/** An expression as a schedule: in words and its next runs; broken — why (in words). */
export function cronCheck(expr: string, count = 3, from = new Date()): { ok: true; words: string; next: Date[] } | { ok: false; error: string } {
  const format = guessFormat(expr)
  if (!format) return { ok: false, error: 'Не cron-выражение: нужно 5 полей (мин час день месяц день_недели) или 6 с секундами' }
  try {
    const next = nextRuns(expr, format, count, from)
    if (!next.length) return { ok: false, error: 'По этому выражению запусков больше не будет' }
    return { ok: true, words: describeCron(expr, format), next }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
/** The times a job was due within (from, to] (at most `max` — a long sleep counts the rest as one). */
export function dueBetween(expr: string, from: number, to: number, max = 1000): number[] {
  const format = guessFormat(expr)
  if (!format || to <= from) return []
  const out: number[] = []
  let at = new Date(from)
  while (out.length < max) {
    const [next] = nextRuns(expr, format, 1, at)
    if (!next || next.getTime() > to) break
    out.push(next.getTime())
    at = next
  }
  return out
}
/** When it runs next (none — off, or never again). */
export function nextDue(job: Pick<CronJob, 'expr' | 'on'>, from = Date.now()): number | undefined {
  if (!job.on) return undefined
  const format = guessFormat(job.expr)
  if (!format) return undefined
  try {
    return nextRuns(job.expr, format, 1, new Date(from))[0]?.getTime()
  } catch {
    return undefined
  }
}
/** A run put first in the journal (the oldest beyond the kept ones go). */
export const withRun = (job: CronJob, run: CronRun): CronJob => ({ ...job, runs: [run, ...job.runs].slice(0, CRON_RUNS_KEPT) })

/** A job as kept: every field checked; broken (no note, a broken expression) — none. */
export function cleanJob(x: unknown): CronJob | undefined {
  const j = (x ?? {}) as Partial<CronJob>
  const note = typeof j.note === 'string' ? j.note.trim().replace(/\\/g, '/').replace(/^\/+/, '') : ''
  const expr = typeof j.expr === 'string' ? j.expr.trim().replace(/\s+/g, ' ') : ''
  if (!note || !cronCheck(expr).ok) return undefined
  return {
    id: typeof j.id === 'string' && /^[\w-]{1,64}$/.test(j.id) ? j.id : crypto.randomUUID(),
    note,
    expr,
    title: typeof j.title === 'string' ? j.title.trim().slice(0, CRON_TITLE_MAX) : '',
    on: j.on !== false,
    created: typeof j.created === 'number' ? j.created : Date.now(),
    runs: Array.isArray(j.runs) ? j.runs.filter((r): r is CronRun => !!r && typeof r.at === 'number' && (CRON_RUN_STATES as readonly unknown[]).includes(r.state)).slice(0, CRON_RUNS_KEPT) : [],
  }
}
/** A job's name in words: its own, else its note's. */
export const jobTitle = (j: Pick<CronJob, 'title' | 'note'>): string => j.title || (j.note.split('/').pop() ?? j.note).replace(/\.md$/i, '')

/** The line a message sent by a scheduled run carries (any AI reading the chat knows it was the schedule, not a person). */
export const cronMark = (t: RunTrigger | undefined): string => (t?.by === 'cron' && t.cron ? `⏰ по расписанию «${t.cron.title}» (${t.cron.expr})` : '')
