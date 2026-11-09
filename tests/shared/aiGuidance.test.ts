import { describe, expect, it, vi } from 'vitest'
import { beforeReturn, isRunPicture, wrapCheck, SCENARIO_SHOTS } from '../../src/shared/qaChecks'
import { PageScreen } from '../../src/main/runner/pageScreen'
import { isName } from '../../src/notebook/domain/blockInfo'
import { checkLines } from '../../src/notebook/blocks/pw/modelReport'
import { harnessBrief } from '../../src/shared/agent/harness/prompt'
import { DEFAULT_HARNESS_LIMITS, REVIEWER_OFF, REVIEWER_SELF } from '../../src/shared/agent/harness/constants'
import { newRun } from '../../src/shared/agent/harness/model'

describe('a ready check put after the actions', () => {
  it('goes before the scenario’s closing return — after it, it would never run', () => {
    const code = "await page.goto('/')\nawait page.click('a')\nreturn {\n  url: page.url(),\n}"
    const r = wrapCheck(code, 'layout')
    expect('code' in r && r.code).toBe("await page.goto('/')\nawait page.click('a')\nawait qa.layout() // шаг: Проверить вёрстку на разных экранах и масштабах\nreturn {\n  url: page.url(),\n}")
  })
  it('no closing return — at the end; a return inside a step is not the scenario’s', () => {
    expect(beforeReturn("await page.goto('/')", 'X')).toBe("await page.goto('/')\nX")
    expect(beforeReturn("await step('a', async () => {\n  return 1\n})", 'X')).toBe("await step('a', async () => {\n  return 1\n})\nX")
  })
})

describe('the pictures a run hands out', () => {
  it('its last page, the layout screens, the scenario’s own shots — nothing else of its folder', () => {
    for (const n of ['final.png', 'failure.png', 'layout-360x640-100.png', 'shot-3.png']) expect(isRunPicture(n)).toBe(true)
    for (const n of ['trace.zip', '../x.png', 'shot-a.png', 'shot-1.png.exe']) expect(isRunPicture(n)).toBe(false)
  })
})

describe('the screen a run sets', () => {
  const fakePage = () => {
    const sent: Array<[string, unknown]> = []
    const page = {
      viewportSize: () => ({ width: 1280, height: 800 }),
      setViewportSize: vi.fn(async () => undefined),
      context: () => ({ newCDPSession: async () => ({ send: async (m: string, p: unknown) => void sent.push([m, p]) }) }),
    }
    return { page, sent }
  }
  it('a page zoomed to 80 %: the window × the zoom, the density ÷ it — the page sees exactly the CSS px asked', async () => {
    const { page, sent } = fakePage()
    const screen = new PageScreen(page as never, 0.8)
    screen.takeOver()
    await (page as unknown as { setViewportSize(s: object): Promise<void> }).setViewportSize({ width: 360, height: 640 })
    expect(sent).toEqual([['Emulation.setDeviceMetricsOverride', { width: 288, height: 512, deviceScaleFactor: 1.25, mobile: false }]])
    expect((page as unknown as { viewportSize(): unknown }).viewportSize()).toEqual({ width: 360, height: 640 })
  })
  it('no zoom, density 1 — Playwright’s own way; a density — the override; back to 1 — taken off first', async () => {
    const { page, sent } = fakePage()
    const own = page.setViewportSize
    const screen = new PageScreen(page as never, 1)
    await screen.set({ width: 375, height: 900 })
    expect(own).toHaveBeenCalledWith({ width: 375, height: 900 })
    await screen.set({ width: 300, height: 720, dpr: 1.25 })
    await screen.set({ width: 375, height: 900 })
    expect(sent.map(([m]) => m)).toEqual(['Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride'])
  })
})

describe('what the AI is told', () => {
  it('a name the scenario’s helpers have stays a block’s name (notes named so are not broken); Playwright’s own are not', () => {
    for (const n of ['qa', 'gen', 'emit', 'shot', 'fetch', 'browser1']) expect(isName(n)).toBe(true)
    for (const n of ['browser', 'page', 'context']) expect(isName(n)).toBe(false)
  })
  it('the run’s report says the pictures are there, and which screens have faults', () => {
    const lines = checkLines([{ kind: 'layout', name: 'Вёрстка', state: 'fail', summary: 'найдено проблем: 1', shots: [{ file: 'a.png', label: '375 px · 100%', bad: 2 }, { file: 'b.png', label: '768 px · 100%', bad: 0 }] }, { kind: SCENARIO_SHOTS, name: 'Снимки сценария', state: 'ok', summary: 'снимков: 1', shots: [{ file: 'shot-1.png', label: 'главная', bad: 0 }] }], false)
    expect(lines).toContain('  снимков в результате блока: 2 · с отмеченными проблемами: 375 px · 100%')
    expect(lines).toContain('  снимков в результате блока: 1')
  })
  it('with no final review: the plan asks a block for each criterion, the work its data before done', () => {
    const base = newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: REVIEWER_OFF, goal: 'Вёрстка', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: false }, 1)
    expect(harnessBrief(base, 'plan', 2)).toMatch(/финальной проверки нет: критерий без блока-проверки не проверит никто/)
    const run = { ...base, steps: [{ title: 'Тест', state: 'doing' as const }], criteria: [{ id: 1, text: 'Снимки', check: { path: 'T.md', block: 'x' } }, { id: 2, text: 'Итог в документе' }] }
    expect(harnessBrief(run, 'work', 2)).toMatch(/критерии 2 без блока — перед done приведи по каждому данные/)
    expect(harnessBrief(run, 'work', 2)).toMatch(/запусти \(note_run\) и прочитай результат до отчёта/)
    expect(harnessBrief({ ...run, reviewer: REVIEWER_SELF }, 'work', 2)).not.toMatch(/Финальной проверки нет/)
  })
})
