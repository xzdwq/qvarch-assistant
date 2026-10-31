import type { CheckResult, HarnessCriterion } from './model'

const sameCheck = (a: HarnessCriterion, b: HarnessCriterion) => !!a.check && a.check.path === b.check?.path && a.check.block === b.check?.block

/**
 * A criterion's check result that stands without a run: its block ran — for it or for another criterion on the same
 * block — and its text is as it was then (`body` — the block's text now): the same block on the same site gives the
 * same answer, passed or not (the agent changes only the notes — nothing else is new). `fresh` (before the work) — none.
 */
export function standingResult(c: HarnessCriterion, criteria: readonly HarnessCriterion[], body: string, fresh: boolean): CheckResult | undefined {
  if (fresh) return undefined
  return criteria.find((o) => sameCheck(o, c) && o.result && !o.result.missing && o.ranOn === body)?.result
}
