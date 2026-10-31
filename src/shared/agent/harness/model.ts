import type { HarnessLimits, HarnessPhase, StepState, StopReason } from './constants'
import type { PlannedCriterion } from './report'
import type { PlanGuides } from './guides'

/**
 * A check's outcome: passed or not, when, why not (cut); `missing` — its note or block is not there (yet); `findings`
 * — it ran through and its ready checks found problems of the thing tested (not the test broken).
 */
export interface CheckResult {
  ok: boolean
  at: number
  error?: string
  missing?: boolean
  findings?: boolean
}
/** A criterion of the run: its check's result now and before the work started, the check's texts they came from. */
export interface HarnessCriterion extends PlannedCriterion {
  id: number
  result?: CheckResult
  baseline?: CheckResult
  /**
   * The check's text before the work started (it was there then): changed later — the person is asked (a check given
   * is never bent to pass). A check the agent writes itself in the work — none: it is its to shape.
   */
  guard?: string
  /** The check's text its last result came from (the same text passed — not run again before the end). */
  ranOn?: string
}
export interface HarnessStep {
  title: string
  state: StepState
  note?: string
}
/** A line of the run's journal (the panel shows the latest). */
export interface HarnessLogLine {
  at: number
  text: string
  tone: 'info' | 'ok' | 'fail'
}

/** A harness run in a chat room: what it works for, where it stands, what the next turn is told. */
export interface HarnessRun {
  id: string
  room: string
  /** The chat's agent working (its id in the room) and its profile; who reviews at the end (`HarnessSettings.reviewer`). */
  agent: string
  agentName: string
  profile: string
  reviewer: string
  goal: string
  /** The note the chat is in (the app's signals open it). */
  doc?: string
  /** The instructions the work and the final check follow (the plan's; the person's when `pinned`). */
  guides?: PlanGuides
  /** The person chose the instructions: a plan made anew keeps them. */
  pinned?: boolean
  /** «Начать» pressed with what the agent was to take in: its next plan goes to work at once. */
  go?: boolean
  /** How many times the final check turned the work back (once — then the person decides). */
  returned?: number
  /** The steps and criteria the person took out of a plan (by their text): a plan made anew never brings them back. */
  dropped?: { steps: string[]; criteria: string[] }
  phase: HarnessPhase
  steps: HarnessStep[]
  criteria: HarnessCriterion[]
  /** Work turns made; the limit counts from `iterBase` (a run resumed has the limit anew). */
  iteration: number
  iterBase: number
  /** When it (re)started: the time limit counts from here. */
  startedAt: number
  limits: HarnessLimits
  confirmPlan: boolean
  /** The agent said all is done: the checks then the review. */
  finishing?: boolean
  /** The step whose checks are being run (its index). */
  checking?: number
  /** The values the next checks run anew though remembered (named by the agent or the review: what it doubts). */
  recheck?: string[]
  /** Stopped because the agent changed a check given: «Продолжить» — the next checks take them as they are then. */
  bent?: boolean
  /** The failure seen last and how many times in a row. */
  failure?: { sig: string; count: number }
  turnErrors: number
  silent: number
  /** The person's messages meanwhile: told to the next turn. */
  hints: string[]
  /** What the next turn must fix (failed checks, the review's remarks, a missing report). */
  fix?: string
  /** The agent's last words on its work. */
  lastNote?: string
  /** The agent's question to the person. */
  question?: string
  stop?: StopReason
  log: HarnessLogLine[]
}

/**
 * What the app does next for a run. The checks: of these criteria; `fresh` — each run anew (before the work), else one
 * passed already whose check is as it was is not run again.
 */
/** `recheck` — the values of the checks to run anew though remembered (their blocks run even when unchanged). */
export type HarnessNext = { kind: 'turn'; mode: TurnMode } | { kind: 'checks'; baseline: boolean; ids: number[]; fresh: boolean; recheck?: string[] } | { kind: 'wait' } | { kind: 'end' }
/** The kind of turn asked: the plan, work on a step, fixing what failed, the review. */
export const TURN_MODES = ['plan', 'work', 'fix', 'review'] as const
export type TurnMode = (typeof TURN_MODES)[number]

export const LOG_MAX = 80

/** A run started: the plan first. */
export function newRun(o: Pick<HarnessRun, 'id' | 'room' | 'agent' | 'agentName' | 'profile' | 'reviewer' | 'goal' | 'limits' | 'confirmPlan'>, now: number): HarnessRun {
  return { ...o, phase: 'plan', steps: [], criteria: [], iteration: 0, iterBase: 0, startedAt: now, turnErrors: 0, silent: 0, hints: [], log: [{ at: now, text: `Цель: ${o.goal}`, tone: 'info' }] }
}
/** The step being worked on: the one the agent named, else the first not done. */
export function currentStep(run: Pick<HarnessRun, 'steps'>): number {
  const i = run.steps.findIndex((s) => s.state !== 'done')
  return i < 0 ? run.steps.length - 1 : i
}
/** The criteria checked by the app (a runnable block each). */
export const checkedCriteria = (run: Pick<HarnessRun, 'criteria'>) => run.criteria.filter((c) => !!c.check)
