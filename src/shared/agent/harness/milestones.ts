import { HARNESS_ENDED } from './constants'
import type { HarnessCriterion, HarnessRun } from './model'
import { checkMet } from './failures'
import { criterionBasis, stopText } from './acceptance'

/**
 * What the chat is told of a run (the panel shows the rest): the plan when it is made, the end — how it ended, the
 * steps and criteria, the agent's question. Messages of the agent, written by the app.
 */
const STEP_MARK = { todo: '○', doing: '◐', done: '✓', failed: '✗' } as const
/** A criterion's line: its check and how it went; one with no block — who takes it (the review, or the agent's word). */
const criterionLine = (run: HarnessRun) => (c: HarnessCriterion) => {
  const mark = !c.check ? '•' : !c.result || c.result.missing ? '○' : checkMet(c) ? (c.result.ok ? '✓' : '✓ (найдены дефекты)') : '✗'
  const by = c.check ? ` — проверка «${c.check.block}»` : criterionBasis(c, run) === 'word' ? ' — без проверки, по отчёту ИИ' : ' — финальная проверка'
  return `${mark} ${c.text}${by}`
}

/** An instruction's title by its id (unknown — the id). */
export type GuideTitle = (id: string) => string

export function planMessage(run: HarnessRun, titleOf: GuideTitle = (id) => id): string {
  const names = (ids?: string[]) => (ids?.length ? ids.map(titleOf).join(', ') : '—')
  return [
    `🧭 План harness — ${run.goal}`,
    run.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'),
    `Критерии приёмки:\n${run.criteria.map(criterionLine(run)).join('\n')}`,
    `Инструкции работы: ${names(run.guides?.work)}\nИнструкции проверки: ${names(run.guides?.check)}`,
    run.phase === 'confirm' ? 'Поправьте шаги, критерии, инструкции и замечания в панели harness и нажмите «Начать» (или напишите замечание в чат — план составится заново).' : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function endMessage(run: HarnessRun): string {
  const head = run.stop ? stopText(run, run.stop) : 'Работа завершена'
  const icon = run.stop === 'done' ? '✅' : run.stop === 'help' ? '❓' : '⏹'
  return [
    `${icon} Harness: ${head}`,
    run.question ? `Вопрос: ${run.question}\n(ответьте в чате — работа продолжится)` : '',
    run.steps.length ? run.steps.map((s, i) => `${STEP_MARK[s.state]} ${i + 1}. ${s.title}`).join('\n') : '',
    run.criteria.length ? `Критерии:\n${run.criteria.map(criterionLine(run)).join('\n')}` : '',
    run.lastNote && run.stop !== 'help' ? `Последний отчёт ИИ: ${run.lastNote.slice(0, 800)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The message a run's move deserves (none — the panel is enough). */
export function milestoneOf(before: HarnessRun, after: HarnessRun, titleOf?: GuideTitle): string | undefined {
  if (before.phase === 'plan' && after.steps !== before.steps && after.steps.length) return planMessage(after, titleOf)
  if (HARNESS_ENDED.includes(after.phase) && (after.phase !== before.phase || after.stop !== before.stop)) return endMessage(after)
  return undefined
}
