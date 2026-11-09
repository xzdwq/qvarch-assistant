import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { SCENARIO_SHOTS, type QaCheck } from '../../shared/qaChecks'

/**
 * The scenario's own pictures — `shot('mobile-360')`: each into the run's folder and into its results (one entry
 * «Снимки сценария» beside the checks, drawn as theirs: a picture each, its label; a click — bigger). A picture saved
 * by `page.screenshot({ path })` goes wherever it is told and never into the results — this is how one gets there.
 */
export function scenarioShots(page: () => Page | undefined, dir: string, checks: QaCheck[]) {
  let entry: QaCheck | undefined
  let n = 0
  return async (label?: unknown, opts: { fullPage?: boolean } = {}): Promise<string> => {
    const p = page()
    if (!p) throw new Error('shot: страницы ещё нет')
    n++
    const file = `shot-${n}.png`
    await p.screenshot({ path: join(dir, file), fullPage: !!opts.fullPage, timeout: 10_000 })
    const said = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : `Снимок ${n}`
    if (!entry) checks.push((entry = { kind: SCENARIO_SHOTS, name: 'Снимки сценария', state: 'ok', summary: '', shots: [] }))
    entry.shots!.push({ file, label: said, bad: 0 })
    entry.summary = `снимков: ${entry.shots!.length}`
    return file
  }
}
