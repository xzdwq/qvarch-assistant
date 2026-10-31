import { FAILURE_TEXT_MAX } from './constants'
import type { HarnessCriterion } from './model'

/**
 * A criterion's check met: it passed — or it was to run through (`expect: complete`) and did, what it found of the
 * thing tested being its result (a test looking for defects found some).
 */
export const checkMet = (c: HarnessCriterion): boolean => !!c.result && (c.result.ok || (c.expect === 'complete' && !!c.result.findings))
/** The criteria whose checks failed in the last run of them. */
export const failedCriteria = (criteria: readonly HarnessCriterion[]) => criteria.filter((c) => c.check && c.result && !checkMet(c))

/**
 * A failure told apart from another: which checks failed and how (their first lines, the numbers, times and ids taken
 * out — the same error on another run is the same failure).
 */
export function failureSignature(failed: readonly HarnessCriterion[]): string {
  return failed
    .map((c) => {
      const first = (c.result?.error ?? '').split('\n').find((l) => l.trim()) ?? ''
      const plain = first
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '#')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
      return `${c.id}:${plain}`
    })
    .sort()
    .join('|')
}

/** The failed checks as the next turn is told of them (each cut; all together within the size). */
export function failureText(failed: readonly HarnessCriterion[]): string {
  const each = Math.max(200, Math.floor(FAILURE_TEXT_MAX / Math.max(1, failed.length)))
  return failed
    .map((c) => {
      const err = (c.result?.error ?? 'не прошла').trim()
      const cut = err.length > each ? `${err.slice(0, each)}…` : err
      return `- Критерий ${c.id} «${c.text}» — проверка ${c.check!.block} (${c.check!.path}) не прошла:\n${cut}`
    })
    .join('\n')
}
