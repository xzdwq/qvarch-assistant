import type { PwStep } from '../../../shared/api'
import type { QaCheck } from '../../../shared/qaChecks'
import { durationText } from '../../engine/reportText'

/**
 * A Playwright run's report parts, sized for reading (a person, an AI agent): its steps — the failed ones and the
 * last ones, the rest counted; its ready checks — a line each for their rows (a matrix's value each), within a size.
 */
export const STEPS_SHOWN = 30
const CHECK_ROWS_SHOWN = 80
const CHECK_ROW_MAX = 220
const CHECKS_TEXT_MAX = 12_000

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const mark = (s: string) => (s === 'ok' ? '✅' : s === 'run' ? '⏳' : s === 'warn' ? '⚠️' : '❌')

/** The steps: all of them when few; else the failed ones (with what came before them) and the last ones, the rest counted. */
export function stepLines(steps: readonly PwStep[], brief: boolean): string[] {
  const line = (st: PwStep) => [`${'  '.repeat(st.depth + 1)}${mark(st.state)} ${st.name}${st.ms !== undefined ? ` — ${durationText(st.ms)}` : ''}`, ...(st.error && !brief ? [`${'  '.repeat(st.depth + 2)}${cut(st.error, 300)}`] : [])]
  if (steps.length <= STEPS_SHOWN) return steps.flatMap(line)
  const keep = new Set<number>()
  steps.forEach((st, i) => st.state !== 'ok' && [i - 1, i].forEach((k) => k >= 0 && keep.add(k)))
  for (let i = Math.max(0, steps.length - 10); i < steps.length; i++) keep.add(i)
  const out: string[] = []
  let skipped = 0
  steps.forEach((st, i) => {
    if (!keep.has(i)) return void skipped++
    if (skipped) out.push(`  … ещё шагов: ${skipped}, все ✅`)
    skipped = 0
    out.push(...line(st))
  })
  return out
}

/** The ready checks: each one's verdict, its rows a line each (a matrix — every value), all within the size. */
export function checkLines(checks: readonly QaCheck[], brief: boolean): string[] {
  const out: string[] = []
  let size = 0
  for (const c of checks) {
    out.push(`${mark(c.state)} Проверка «${c.name}»: ${c.summary}`)
    // (the pictures are in the block's results — said, with the screens whose faults are outlined)
    if (c.shots?.length) out.push(`  снимков в результате блока: ${c.shots.length}${c.shots.some((x) => x.bad) ? ` · с отмеченными проблемами: ${c.shots.filter((x) => x.bad).map((x) => x.label).join(', ')}` : ''}`)
    if (brief || !c.rows?.length) continue
    if (c.head?.length) out.push(`  ${c.head.join(' | ')}`)
    const rows = c.rows.slice(0, CHECK_ROWS_SHOWN)
    for (const [i, r] of rows.entries()) {
      const l = `  ${c.marks?.[i] ? mark(c.marks[i]) : ''} ${cut(r.join(' | '), CHECK_ROW_MAX)}`
      if (size + l.length > CHECKS_TEXT_MAX) {
        out.push(`  … ещё строк: ${c.rows.length - i} (всё — в значении блока и в его таблице проверки)`)
        return out
      }
      size += l.length
      out.push(l)
    }
    if (c.rows.length > rows.length) out.push(`  … ещё строк: ${c.rows.length - rows.length}`)
  }
  return out
}
