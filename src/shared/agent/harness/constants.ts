/**
 * Harness: an agent's work in a chat led by the app, not by the model — a plan with criteria, steps, checks run by the
 * app, a fresh review at the end; the model takes short turns, the app decides what comes next.
 */

/** Where a harness run is: the plan made, waiting for the person's yes, the checks' start, work, checks, the review, the end. */
export const HARNESS_PHASES = ['plan', 'confirm', 'baseline', 'work', 'check', 'review', 'help', 'done', 'stopped'] as const
export type HarnessPhase = (typeof HARNESS_PHASES)[number]
/** Each phase in words (the panel's head). */
export const HARNESS_PHASE_TEXT: Record<HarnessPhase, string> = {
  plan: 'план',
  confirm: 'ждёт «Начать»',
  baseline: 'проверки до начала',
  work: 'работа',
  check: 'проверки',
  review: 'финальная проверка',
  help: 'нужен человек',
  done: 'готово',
  stopped: 'остановлен',
}
/** The phases a run is over in (the panel shows «Продолжить» on the ones it may go on from). */
export const HARNESS_ENDED: readonly HarnessPhase[] = ['help', 'done', 'stopped']

/** A plan's step: waiting, being done, done, failed (its checks red). */
export const STEP_STATES = ['todo', 'doing', 'done', 'failed'] as const
export type StepState = (typeof STEP_STATES)[number]

/**
 * What the agent says at the end of its turn: going on (call me again), a step done (run the checks), all done (the
 * review), a person needed (a question).
 */
export const REPORT_STATES = ['continue', 'check', 'done', 'help'] as const
export type ReportState = (typeof REPORT_STATES)[number]

/** Why a run stopped (each said to the person in its words). */
export const STOP_REASONS = ['done', 'help', 'iterations', 'time', 'stuck', 'errors', 'silent', 'stopped', 'interrupted', 'rejected'] as const
export type StopReason = (typeof STOP_REASONS)[number]
export const STOP_TEXT: Record<StopReason, string> = {
  done: 'Готово',
  help: 'Нужна помощь человека',
  iterations: 'Достигнут лимит итераций',
  time: 'Достигнут лимит времени',
  stuck: 'Одна и та же ошибка повторяется — похоже, нужен другой подход',
  errors: 'Ход ИИ несколько раз подряд завершился ошибкой',
  silent: 'ИИ несколько ходов подряд не сообщает о ходе работы',
  stopped: 'Остановлено',
  interrupted: 'Прервано (приложение закрывалось)',
  rejected: 'План отклонён',
}

/** The limits of one run (the settings give them; a run may change its own). */
export interface HarnessLimits {
  /** Work turns at most (a check failing and fixed is one more). */
  iterations: number
  minutes: number
  /** The same failure this many times in a row — stuck. */
  sameFailure: number
  /** Turns failing in a row (the model, the connection). */
  turnErrors: number
  /** Turns in a row without a report. */
  silentTurns: number
}
export const DEFAULT_HARNESS_LIMITS: HarnessLimits = { iterations: 10, minutes: 60, sameFailure: 3, turnErrors: 2, silentTurns: 2 }
/** At this share of the time the agent is told to finish the step it is on, not to start a new one. */
export const HARNESS_WRAP_UP = 0.9

/** The harness's settings: the limits, the plan shown first, who reviews at the end (the instructions — apart: guides). */
export interface HarnessSettings {
  limits: HarnessLimits
  /** The plan waits for the person's «Начать». */
  confirmPlan: boolean
  /** Who reviews at the end: no one (`REVIEWER_OFF` — the checks passed are the end), the AI that worked (`REVIEWER_SELF`), an agent profile (its id). */
  reviewer: string
}
export const REVIEWER_OFF = ''
export const REVIEWER_SELF = 'self'
export const DEFAULT_HARNESS: HarnessSettings = { limits: DEFAULT_HARNESS_LIMITS, confirmPlan: true, reviewer: REVIEWER_OFF }

/** What a note shows of the AI in it: it works there, it waits for the person. */
export const AI_SIGNALS = ['work', 'human'] as const
export type AiSignal = (typeof AI_SIGNALS)[number]

/** A note's section with the rules of the work in it (added to the general ones). */
export const DOC_RULES_HEADING = 'Правила harness'
/** The text kept of a failure (a report to the agent, a line in the panel). */
export const FAILURE_TEXT_MAX = 1500
