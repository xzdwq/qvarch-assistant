import { REPORT_STATES, type ReportState } from './constants'
import { planGuidesOf, type PlanGuides } from './guides'

/**
 * A criterion as the agent plans it: what must hold; a runnable block of a note that checks it (none — the review
 * judges it); the step after which it is checked first (from 1; none — at the end only).
 */
export interface PlannedCriterion {
  text: string
  check?: { path: string; block: string }
  step?: number
  /**
   * What its check is to show: `complete` — the test runs through, what it finds of the thing tested is its result
   * (a test looking for defects); none — it passes (the thing works).
   */
  expect?: CheckExpect
}
/** What a criterion's check is to show (none — that it passes). */
export const CHECK_EXPECTS = ['complete'] as const
/** How many values a report may ask run anew. */
export const RECHECK_MAX = 200
export type CheckExpect = (typeof CHECK_EXPECTS)[number]
const expectOf = (v: unknown): { expect?: CheckExpect } => (CHECK_EXPECTS.includes(v as CheckExpect) ? { expect: v as CheckExpect } : {})
/** The plan the agent gives in its first turn: its steps, criteria, and the instructions it works and checks by. */
export interface HarnessPlan {
  steps: string[]
  criteria: PlannedCriterion[]
  /** (none — none chosen) */
  guides?: PlanGuides
}
/** What a plan is checked against: a block's name rule, the instructions there are (none given — any). */
export interface PlanRules {
  nameOk?: BlockNameRule
  guides?: ReadonlySet<string>
}
/** A criterion's check put on a block (the agent's own check: the block it wrote, by its name=). */
export interface CheckBinding {
  criterion: number
  path: string
  block: string
  expect?: CheckExpect
}
/**
 * What the agent says at the end of a turn: how it stands, the step it worked on (from 1), in its words, its question;
 * the checks it put on the blocks it wrote.
 */
export interface HarnessReport {
  state: ReportState
  step?: number
  note: string
  question?: string
  checks?: CheckBinding[]
  /** The final check: the criteria of the plan not met (by their numbers) — only these turn the work back. */
  unmet?: number[]
  /** The checks' values it doubts (their labels or values): the next checks run them anew, the rest kept as they were. */
  recheck?: string[]
}
/** Whether a text may be a block's name= (the notebook's rule; none given — any). */
export type BlockNameRule = (s: string) => boolean
/** What a turn gave the harness (its tools' calls, or a block at the end of its text). */
export interface TurnHarness {
  plan?: HarnessPlan
  report?: HarnessReport
}

const STEPS_MAX = 20
const CRITERIA_MAX = 20
const TEXT_MAX = 600
const text = (v: unknown, max = TEXT_MAX): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const notePath = (p: string) => (/\.(md|qboard)$/i.test(p) ? p : `${p}.md`).replace(/^\/+/, '')

/** A check's block named as a block's name= is (the title of its section is not its name). */
const blockNameError = (block: string, nameOk?: BlockNameRule) =>
  nameOk && !nameOk(block) ? `block «${block}» — это имя блока из его строки name=… (латиница, цифры, _), а не заголовок раздела` : undefined

/** The plan as the tool was called (wrong — what to fix, in words the model reads). */
export function planOf(a: unknown, rules: PlanRules = {}): HarnessPlan | string {
  const { nameOk } = rules
  const o = (a ?? {}) as Record<string, unknown>
  const steps = Array.isArray(o.steps) ? o.steps.map((s) => text(s)).filter(Boolean) : []
  if (!steps.length) return 'Нужен хотя бы один шаг (steps — список строк)'
  if (steps.length > STEPS_MAX) return `Шагов больше ${STEPS_MAX} — объедини мелкие`
  const raw = Array.isArray(o.criteria) ? o.criteria : []
  const criteria: PlannedCriterion[] = []
  for (const c of raw) {
    const x = (typeof c === 'string' ? { text: c } : (c ?? {})) as Record<string, unknown>
    const t = text(x.text)
    if (!t) return 'У каждого критерия нужен text'
    const path = text(x.path, 1000)
    const block = text(x.block, 120)
    if (!!path !== !!block) return `Критерий «${t}»: проверка — это path и block вместе (заметка и имя исполняемого блока)`
    const bad = block ? blockNameError(block, nameOk) : undefined
    if (bad) return `Критерий «${t}»: ${bad}`
    const step = Number(x.step)
    if (x.step !== undefined && !(Number.isInteger(step) && step >= 1 && step <= steps.length)) return `Критерий «${t}»: step — номер шага от 1 до ${steps.length}`
    criteria.push({ text: t, ...(path ? { check: { path: notePath(path), block } } : {}), ...(x.step !== undefined ? { step } : {}), ...(path ? expectOf(x.expect) : {}) })
  }
  if (!criteria.length) return 'Нужен хотя бы один критерий приёмки (criteria)'
  if (criteria.length > CRITERIA_MAX) return `Критериев больше ${CRITERIA_MAX} — оставь главные`
  // the instructions it plans by and checks by (the catalog's; none — any ids kept as given)
  const known = rules.guides
  const ids = (v: unknown): string[] | string => (known ? planGuidesOf(v, known) : Array.isArray(v) ? [...new Set(v.map(String))] : [])
  const work = ids(o.guides)
  if (typeof work === 'string') return `guides: ${work}`
  const check = ids(o.checkGuides)
  if (typeof check === 'string') return `checkGuides: ${check}`
  return { steps, criteria, guides: { work, check } }
}

/** The report as the tool was called (wrong — what to fix). */
export function reportOf(a: unknown, nameOk?: BlockNameRule): HarnessReport | string {
  const o = (a ?? {}) as Record<string, unknown>
  const state = o.state as ReportState
  if (!REPORT_STATES.includes(state)) return `state — одно из: ${REPORT_STATES.join(', ')}`
  const note = text(o.note, 2000)
  const question = text(o.question, 2000)
  if (state === 'help' && !question && !note) return 'state=help: напиши вопрос человеку (question)'
  const checks: CheckBinding[] = []
  for (const c of Array.isArray(o.checks) ? o.checks : []) {
    const x = (c ?? {}) as Record<string, unknown>
    const criterion = Number(x.criterion)
    const path = text(x.path, 1000)
    const block = text(x.block, 120)
    if (!Number.isInteger(criterion) || !path || !block) return 'checks — список { criterion: номер критерия, path: заметка, block: имя блока (name=…) }'
    const bad = blockNameError(block, nameOk)
    if (bad) return bad
    checks.push({ criterion, path: notePath(path), block, ...expectOf(x.expect) })
  }
  const step = Number(o.step)
  const unmet = Array.isArray(o.unmet) ? [...new Set(o.unmet.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []
  const recheck = Array.isArray(o.recheck) ? [...new Set(o.recheck.map((v) => text(typeof v === 'number' ? String(v) : v, 200)).filter(Boolean))].slice(0, RECHECK_MAX) : []
  return {
    state,
    note,
    ...(Number.isInteger(step) && step > 0 ? { step } : {}),
    ...(question ? { question } : {}),
    ...(checks.length ? { checks } : {}),
    ...(unmet.length ? { unmet } : {}),
    ...(recheck.length ? { recheck } : {}),
  }
}

/** The block a model with no tools ends its answer with: ```harness {…json…}```. */
const TEXT_BLOCK = /```harness\s*\n([\s\S]*?)\n```\s*$/
/**
 * A turn's text read for the harness when its tools were not called: the block at its end (a plan — `steps`; else a
 * report), the text without it. No block (or a broken one) — nothing.
 */
export function harnessInText(answer: string, rules: PlanRules = {}): { text: string; harness?: TurnHarness } {
  const m = TEXT_BLOCK.exec(answer.trimEnd())
  if (!m) return { text: answer }
  const rest = answer.trimEnd().slice(0, m.index).trimEnd()
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>
    const read = 'steps' in o ? planOf(o, rules) : reportOf(o, rules.nameOk)
    if (typeof read === 'string') return { text: answer }
    return { text: rest, harness: 'steps' in read ? { plan: read } : { report: read } }
  } catch {
    return { text: answer }
  }
}
