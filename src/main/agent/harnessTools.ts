import { guidesText, type HarnessGuide } from '../../shared/agent/harness/guides'
import { harnessInText, planOf, reportOf, type PlanRules, type TurnHarness } from '../../shared/agent/harness/report'
import { HARNESS_GUIDES_TOOL, HARNESS_PLAN_TOOL, HARNESS_REPORT_TOOL } from '../../shared/agent/harness/tools'
import type { McpTool } from '../mcp'
import { isName } from '../../notebook/domain/blockInfo'

const notePath = (p: string) => (/\.(md|qboard)$/i.test(p) ? p : `${p}.md`).replace(/^\/+/, '')
/**
 * The turn's tools with the harness's checks kept to the harness: a run of a block a criterion is checked by (or of
 * the whole note it is in) refused — the harness runs it after the step, once; the agent says check instead (a long
 * check run by the agent mid-turn is run again by the harness: twice for nothing, and its turns spent waiting).
 */
export function harnessGuarded(tools: McpTool[], checks: ReadonlyArray<{ path: string; block: string }>): McpTool[] {
  return tools.map((t) =>
    t.name !== 'note_run'
      ? t
      : {
          ...t,
          run: async (a) => {
            const path = notePath(String(a.path ?? ''))
            const block = typeof a.block === 'string' && a.block.trim() ? a.block.trim() : undefined
            const hit = checks.find((c) => c.path === path && (!block || c.block === block))
            if (hit) throw new Error(`«${hit.block}» — проверка критерия: её запускает harness после шага (один раз, с результатом по каждому значению). Закончи шаг и сообщи harness_report state=check — результат придёт в следующем ходе.`)
            return t.run(a)
          },
        },
  )
}

/**
 * A harness turn's own tools: the instructions read (by their ids in the catalog), the plan and the report — kept
 * for the window (it leads the run). A wrong call — said back to the model to call again; the last right one counts.
 */
export class HarnessTurn {
  private got: TurnHarness = {}
  private rules: PlanRules

  /** `guides` — the person's instructions now (the catalog the agent chose from). */
  constructor(private guides: readonly HarnessGuide[]) {
    this.rules = { nameOk: isName, guides: new Set(guides.filter((g) => g.enabled).map((g) => g.id)) }
  }

  tools(): McpTool[] {
    return [
      {
        ...HARNESS_GUIDES_TOOL,
        access: 'read',
        run: async (a) => {
          const ids = Array.isArray(a.ids) ? a.ids.map(String) : []
          if (!ids.length) throw new Error('ids — список id инструкций из каталога')
          const { text, missing } = guidesText(ids, this.guides)
          return [text, missing.length ? `Нет таких инструкций (или выключены): ${missing.join(', ')}` : ''].filter(Boolean).join('\n\n') || 'Ничего не найдено'
        },
      },
      {
        ...HARNESS_PLAN_TOOL,
        access: 'read',
        run: async (a) => {
          const plan = planOf(a, this.rules)
          if (typeof plan === 'string') throw new Error(plan)
          this.got = { ...this.got, plan }
          return `План принят: ${plan.steps.length} шаг., ${plan.criteria.length} критер., инструкций ${plan.guides?.work.length ?? 0} + ${plan.guides?.check.length ?? 0}. Закончи ход.`
        },
      },
      {
        ...HARNESS_REPORT_TOOL,
        access: 'read',
        run: async (a) => {
          const report = reportOf(a, isName)
          if (typeof report === 'string') throw new Error(report)
          this.got = { ...this.got, report }
          return 'Отчёт принят. Закончи ход — приложение продолжит само.'
        },
      },
    ]
  }
  /** What the turn gave: its tools' calls, else the block at the end of its text (the text without it). */
  ended(text: string): { text: string; harness?: TurnHarness } {
    if (this.got.plan || this.got.report) return { text, harness: this.got }
    return harnessInText(text, this.rules)
  }
}
