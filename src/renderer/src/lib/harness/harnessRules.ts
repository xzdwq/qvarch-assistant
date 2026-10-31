import { DOC_RULES_HEADING } from '@shared/agent/harness/constants'
import { sectionOf } from '@shared/notebook/links'

/** The note's own rules of the work in it: its section «Правила harness» (none — none), its heading taken off. */
export function docRulesOf(docText?: string): string | undefined {
  const own = docText ? sectionOf(docText, DOC_RULES_HEADING) : undefined
  return own ? own.split('\n').slice(1).join('\n').trim() || undefined : undefined
}
