import { REVIEWER_OFF, STOP_TEXT, type StopReason } from './constants'
import type { HarnessCriterion, HarnessRun } from './model'

/**
 * How a criterion was taken at the end: by its check block, by the final review, or only by the agent's word (no
 * block, no review) — the end says which, never «checked» for what nobody checked.
 */
export const CRITERION_BASES = ['check', 'review', 'word'] as const
export type CriterionBasis = (typeof CRITERION_BASES)[number]

export const criterionBasis = (c: HarnessCriterion, run: Pick<HarnessRun, 'reviewer'>): CriterionBasis => (c.check ? 'check' : run.reviewer === REVIEWER_OFF ? 'word' : 'review')

const BASIS_TEXT: Record<CriterionBasis, string> = {
  check: 'проверено блоками',
  review: 'принято финальной проверкой',
  word: 'без проверки, по отчёту ИИ',
}

/** The words a run ends with: done — what its criteria rest on, counted; else the stop's reason. */
export function stopText(run: Pick<HarnessRun, 'criteria' | 'reviewer'>, reason: StopReason): string {
  if (reason !== 'done' || !run.criteria.length) return STOP_TEXT[reason]
  const counts = new Map<CriterionBasis, number>()
  for (const c of run.criteria) counts.set(criterionBasis(c, run), (counts.get(criterionBasis(c, run)) ?? 0) + 1)
  return `Готово: ${CRITERION_BASES.filter((b) => counts.has(b))
    .map((b) => `${BASIS_TEXT[b]} — ${counts.get(b)}`)
    .join('; ')}`
}
