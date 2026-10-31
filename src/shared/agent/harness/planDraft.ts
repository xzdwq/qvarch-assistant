import type { HarnessCriterion, HarnessRun, HarnessStep } from './model'
import type { PlanGuides } from './guides'

/**
 * A plan as the person edited it in its window (the steps' and the criteria's texts): taken as it is — their word is
 * the plan, no turn of the agent needed. A criterion kept (its text as it was, or edited where it stood) keeps its
 * check; a new one is the final check's to judge.
 */
export interface PlanDraft {
  steps: string[]
  criteria: string[]
}
/**
 * The plan's window's corrections «Начать» goes with: `agent` — something for the agent to take in first (other
 * instructions, remarks); the plan as edited; the instructions chosen.
 */
export interface PlanEdits {
  agent: boolean
  remarks: string
  draft?: PlanDraft
  guides?: PlanGuides
}

/** The run's plan with the person's edits. */
export function appliedDraft(run: Pick<HarnessRun, 'steps' | 'criteria'>, d: PlanDraft): { steps: HarnessStep[]; criteria: HarnessCriterion[] } {
  const steps = d.steps.map((title) => ({ title, state: 'todo' as const }))
  const used = new Set<number>()
  const criteria = d.criteria.map((text, i): HarnessCriterion => {
    // the same text — the same criterion; else the one that stood here, edited (its text gone from the edits)
    const same = run.criteria.find((c) => c.text === text && !used.has(c.id))
    const here = run.criteria[i]
    const was = same ?? (here && !used.has(here.id) && !d.criteria.includes(here.text) ? here : undefined)
    if (was) used.add(was.id)
    const step = was?.step !== undefined && was.step <= steps.length ? was.step : undefined
    return { id: i + 1, text, ...(was?.check ? { check: was.check } : {}), ...(step !== undefined ? { step } : {}) }
  })
  return { steps, criteria }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
/** What the person has taken out so far, this edit's added (by their text). */
export function droppedBy(run: Pick<HarnessRun, 'steps' | 'criteria' | 'dropped'>, d: PlanDraft): { steps: string[]; criteria: string[] } {
  const out = (was: string[], now: string[]) => was.filter((x) => !now.includes(x))
  return {
    steps: [...new Set([...(run.dropped?.steps ?? []), ...out(run.steps.map((s) => s.title), d.steps)])],
    criteria: [...new Set([...(run.dropped?.criteria ?? []), ...out(run.criteria.map((c) => c.text), d.criteria)])],
  }
}
/** A plan the agent gave without what the person took out (the same text, its case and spaces aside). */
export function withoutDropped<P extends { steps: string[]; criteria: Array<{ text: string }> }>(plan: P, dropped?: { steps: string[]; criteria: string[] }): P {
  if (!dropped) return plan
  const steps = new Set(dropped.steps.map(norm))
  const criteria = new Set(dropped.criteria.map(norm))
  return { ...plan, steps: plan.steps.filter((s) => !steps.has(norm(s))), criteria: plan.criteria.filter((c) => !criteria.has(norm(c.text))) }
}

/** What the person changed in the plan, in words the next plan is told (taken away — not to come back). */
export function draftWords(run: Pick<HarnessRun, 'steps' | 'criteria'>, d: PlanDraft): string {
  const was = { steps: run.steps.map((s) => s.title), criteria: run.criteria.map((c) => c.text) }
  const gone = (a: string[], b: string[]) => a.filter((x) => !b.includes(x))
  const lines = [
    ...gone(was.steps, d.steps).map((s) => `- шаг удалён: «${s}»`),
    ...gone(d.steps, was.steps).map((s) => `- шаг добавлен / изменён: «${s}»`),
    ...gone(was.criteria, d.criteria).map((c) => `- критерий удалён: «${c}»`),
    ...gone(d.criteria, was.criteria).map((c) => `- критерий добавлен / изменён: «${c}»`),
  ]
  if (!lines.length) return ''
  return [
    'Человек поправил план. Это его решение — сохрани его в новом плане: удалённое не возвращай, добавленное и изменённое оставь как есть.',
    ...lines,
    `План после правок:\nШаги:\n${d.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\nКритерии:\n${d.criteria.map((c) => `- ${c}`).join('\n')}`,
  ].join('\n')
}
