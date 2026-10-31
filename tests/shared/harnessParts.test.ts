import { describe, expect, it } from 'vitest'
import { DEFAULT_HARNESS, DEFAULT_HARNESS_LIMITS } from '../../src/shared/agent/harness/constants'
import { advance } from '../../src/shared/agent/harness/machine'
import { milestoneOf } from '../../src/shared/agent/harness/milestones'
import { newRun } from '../../src/shared/agent/harness/model'
import { cleanHarnessSettings, isHarnessRun } from '../../src/shared/agent/harness/settings'
import { HarnessTurn } from '../../src/main/agent/harnessTools'
import { buildPack } from '../../src/shared/agent/contextPack'
import { standingResult } from '../../src/shared/agent/harness/reuse'

const run0 = (confirmPlan: boolean) => newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: '', goal: 'Цель', limits: DEFAULT_HARNESS_LIMITS, confirmPlan }, 0)
const plan = { steps: ['Шаг'], criteria: [{ text: 'Сохраняется', check: { path: 'T.md', block: 'save' } }] }

describe('harness in the chat', () => {
  it('tells the chat the plan (asking for «Начать» when it waits) and the end — nothing else', () => {
    const before = run0(true)
    const planned = advance(before, { kind: 'turn', harness: { plan } }, 1).run
    const said = milestoneOf(before, planned)
    expect(said).toContain('1. Шаг')
    expect(said).toContain('проверка «save»')
    expect(said).toContain('«Начать»')
    const started = advance(planned, { kind: 'confirm' }, 2).run
    expect(milestoneOf(planned, started)).toBeUndefined()
    const stopped = advance(started, { kind: 'stop' }, 3).run
    expect(milestoneOf(started, stopped)).toContain('Остановлено')
  })
  it('keeps the settings within reason', () => {
    expect(cleanHarnessSettings(undefined)).toEqual(DEFAULT_HARNESS)
    const s = cleanHarnessSettings({ rulesNote: ' Правила.md ', limits: { iterations: 0, minutes: 'x', sameFailure: 99 }, confirmPlan: false, reviewer: 'p2' })
    expect(s).toMatchObject({ confirmPlan: false, reviewer: 'p2', limits: { iterations: 1, minutes: 60, sameFailure: 20 } })
    expect(isHarnessRun(run0(false))).toBe(true)
    expect(isHarnessRun({ id: 'x' })).toBe(false)
  })
})

describe('a check not run again for nothing', () => {
  const c = (id: number, block: string, result?: { ok: boolean }, ranOn?: string) => ({ id, text: 't', check: { path: 'T.md', block }, ...(result ? { result: { ...result, at: 1 } } : {}), ...(ranOn ? { ranOn } : {}) })
  it('a block run and unchanged stands, passed or not — for any criterion on it; changed or before the work — runs', () => {
    const list = [c(1, 'search', { ok: true }, 'B1'), c(2, 'search'), c(3, 'other', { ok: false }, 'X')]
    expect(standingResult(list[1], list, 'B1', false)?.ok).toBe(true)
    expect(standingResult(list[0], list, 'B2', false)).toBeUndefined()
    // (the same block on the same site: the same red — not run again for nothing)
    expect(standingResult(list[2], list, 'X', false)?.ok).toBe(false)
    expect(standingResult(list[0], list, 'B1', true)).toBeUndefined()
  })
})

describe('harness turn in main', () => {
  it('keeps what its tools were called with; a wrong call is said back', async () => {
    const t = new HarnessTurn([])
    const [, planTool, reportTool] = t.tools()
    await expect(planTool.run({ steps: [] })).rejects.toThrow(/шаг/)
    await planTool.run({ steps: ['a'], criteria: ['b'] })
    await reportTool.run({ state: 'check', note: 'готово', step: 1 })
    expect(t.ended('Текст')).toEqual({ text: 'Текст', harness: { plan: { steps: ['a'], criteria: [{ text: 'b' }], guides: { work: [], check: [] } }, report: { state: 'check', note: 'готово', step: 1 } } })
  })
  it('reads the block at the end of the text when no tool was called', () => {
    const r = new HarnessTurn([]).ended('Сделал.\n```harness\n{"state":"done","note":"всё"}\n```')
    expect(r).toEqual({ text: 'Сделал.', harness: { report: { state: 'done', note: 'всё' } } })
  })
  it('puts the harness after the owner instructions', () => {
    const p = buildPack({ agentName: 'ИИ', owner: 'Я', instructions: 'Кратко', links: [], folder: [], messages: [{ name: 'Harness', text: 'продолжай' }], question: 0, budget: 50_000, tools: true, harness: '## Задача harness\nЦель: X' })
    expect(p.system.indexOf('Указания владельца')).toBeLessThan(p.system.indexOf('## Задача harness'))
  })
})
