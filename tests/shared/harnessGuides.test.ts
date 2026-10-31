import { describe, expect, it } from 'vitest'
import { DEFAULT_HARNESS_LIMITS } from '../../src/shared/agent/harness/constants'
import { BUILTIN_GUIDES } from '../../src/shared/agent/harness/builtinGuides'
import { guideSeed } from '../../src/shared/agent/harness/guideSeed'
import { cleanGuide, guideCatalog, guideIdOf, guidesText, type HarnessGuide } from '../../src/shared/agent/harness/guides'
import { advance } from '../../src/shared/agent/harness/machine'
import { newRun } from '../../src/shared/agent/harness/model'
import { guidesPart, harnessSystem } from '../../src/shared/agent/harness/prompt'
import { planOf } from '../../src/shared/agent/harness/report'
import { judgeQuery } from '../../src/shared/qaMatrixQuery'
import { checkLines, stepLines, STEPS_SHOWN } from '../../src/notebook/blocks/pw/modelReport'
import { harnessGuarded } from '../../src/main/agent/harnessTools'

const g = (id: string, o: Partial<HarnessGuide> = {}): HarnessGuide => ({ id, title: `T ${id}`, summary: `S ${id}`, body: `B ${id}`, enabled: true, origin: 'user', edited: false, ...o })

describe('the harness instructions', () => {
  it('a new installation gets the app set; an update — to the unedited ones only; a deleted one never back', () => {
    expect(guideSeed([], BUILTIN_GUIDES, new Set()).map((x) => x.id)).toEqual(BUILTIN_GUIDES.map((b) => b.id))
    const b = BUILTIN_GUIDES[0]
    const old = { ...b, body: 'старый текст', enabled: false, origin: 'builtin' as const, edited: false }
    expect(guideSeed([old], [b], new Set())).toEqual([{ ...old, body: b.body }])
    expect(guideSeed([{ ...old, edited: true }], [b], new Set())).toEqual([])
    expect(guideSeed([], [b], new Set([b.id]))).toEqual([])
  })
  it('the catalog is a line each of the enabled ones; the chosen ones given whole, the missing named', () => {
    const list = [g('testing'), g('off', { enabled: false })]
    expect(guideCatalog(list)).toBe('- testing — T testing: S testing')
    const t = guidesText(['testing', 'off', 'gone'], list)
    expect(t.text).toContain('B testing')
    expect(t.missing).toEqual(['off', 'gone'])
  })
  it('a guide kept to its shape; an id made of a title', () => {
    expect(cleanGuide({ id: 'x', title: 't', summary: 's', body: 'b' })).toMatch(/id/)
    expect(cleanGuide({ id: 'my-rules', title: 't', summary: '', body: 'b' })).toMatch(/описание/)
    expect(guideIdOf('Load Testing', new Set(['load-testing']))).toBe('load-testing-2')
    expect(guideIdOf('Нагрузка', new Set())).toBe('guide')
  })
  it('a plan names the instructions there are; an unknown one is said with the ones there are', () => {
    const rules = { guides: new Set(['testing', 'automation']) }
    expect(planOf({ steps: ['a'], criteria: ['b'], guides: ['testing'], checkGuides: ['testing'] }, rules)).toMatchObject({ guides: { work: ['testing'], check: ['testing'] } })
    expect(planOf({ steps: ['a'], criteria: ['b'], guides: ['nope'] }, rules)).toMatch(/нет таких инструкций: nope — есть: testing, automation/)
  })
  it('the plan sees the catalog; the work — its instructions; the review — the check ones', () => {
    const guides = [g('testing'), g('testing-review'), g('automation')]
    let run = newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: '', goal: 'G', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: true }, 0)
    expect(guidesPart(run, 'plan', guides)).toContain('- automation — T automation')
    run = advance(run, { kind: 'turn', harness: { plan: { steps: ['s'], criteria: [{ text: 'c' }], guides: { work: ['testing'], check: ['testing-review'] } } } }, 1).run
    expect(guidesPart(run, 'work', guides)).toContain('B testing')
    expect(guidesPart(run, 'work', guides)).not.toContain('B testing-review')
    expect(guidesPart(run, 'review', guides)).toContain('B testing-review')
    expect(harnessSystem({ run, mode: 'work', now: 2, guides, docRules: 'только чтение' })).toMatch(/Протокол harness[\s\S]*B testing[\s\S]*только чтение[\s\S]*Задача harness/)
  })
  it('the person corrects the plan: their instructions stand over the next plan; their edits and remarks told to it', () => {
    let run = newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: '', goal: 'G', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: true }, 0)
    run = advance(run, { kind: 'turn', harness: { plan: { steps: ['s'], criteria: [{ text: 'c' }], guides: { work: ['testing'], check: [] } } } }, 1).run
    const m = advance(run, { kind: 'replan', guides: { work: ['automation'], check: ['big-data'] }, draft: { steps: ['s1', 's2'], criteria: ['c1'] }, remarks: 'без записи' }, 2)
    expect(m.next).toEqual({ kind: 'turn', mode: 'plan' })
    expect(m.run.pinned).toBe(true)
    expect(m.run.hints.at(-1)).toMatch(/1\. s1[\s\S]*2\. s2[\s\S]*- c1[\s\S]*без записи/)
    const again = advance(m.run, { kind: 'turn', harness: { plan: { steps: ['x'], criteria: [{ text: 'y' }], guides: { work: ['testing'], check: [] } } } }, 3).run
    expect(again.guides).toEqual({ work: ['automation'], check: ['big-data'] })
    expect(again.phase).toBe('confirm')
  })
})

describe('the field matrix of a field that saves nothing', () => {
  const c = { label: 'x', value: 'болт', bad: false }
  it('each value: its request answered, how many found from the answer, the server failing, no request', () => {
    expect(judgeQuery(c, { hints: [], req: { status: 200, res: '{"generalTotal":3,"items":[1,2,3]}', line: 'GET /x' } })).toMatchObject({ state: 'ok', result: 'Ответ 200' })
    expect(judgeQuery(c, { hints: [], req: { status: 200, res: '{"total":42}', line: 'GET /x' } }).found).toBe(42)
    expect(judgeQuery(c, { hints: [], req: { status: 500, res: 'boom', line: 'GET /x' } })).toMatchObject({ state: 'fail', result: 'Ошибка сервера 500' })
    expect(judgeQuery(c, { hints: [], req: { line: 'GET /x' } })).toMatchObject({ state: 'fail', result: 'Нет ответа' })
    expect(judgeQuery(c, { hints: [] })).toMatchObject({ state: 'warn', result: 'Запрос не ушёл' })
    expect(judgeQuery(c, { hints: [], error: 'Timeout' })).toMatchObject({ state: 'fail', result: 'Сценарий не прошёл' })
  })
})

describe('a Playwright report sized for reading', () => {
  it('many steps — the failed ones and the last ones, the rest counted', () => {
    const steps = Array.from({ length: 120 }, (_, i) => ({ name: `s${i}`, depth: 0, start: 0, state: (i === 50 ? 'error' : 'ok') as 'ok' | 'error' }))
    const lines = stepLines(steps, true)
    expect(lines.length).toBeLessThan(STEPS_SHOWN)
    expect(lines.some((l) => l.includes('s50'))).toBe(true)
    expect(lines.some((l) => /ещё шагов: \d+/.test(l))).toBe(true)
  })
  it('a check\'s rows — a line each, within the size', () => {
    const rows = Array.from({ length: 300 }, (_, i) => ['Поиск', `v${i}`, 'x'.repeat(500), 'Ответ 200'])
    const lines = checkLines([{ kind: 'matrix', name: 'Матрица', state: 'ok', summary: 'вариантов 300', head: ['Поле', 'Вариант', 'Значение', 'Итог'], rows }], false)
    expect(lines.join('\n').length).toBeLessThan(20_000)
    expect(lines.at(-1)).toMatch(/ещё строк/)
  })
})

describe('the harness runs its checks, not the agent mid-turn', () => {
  it('a run of a criterion\'s block (or of its whole note) refused; any other — as is', async () => {
    const ran: string[] = []
    const tools = harnessGuarded([{ name: 'note_run', description: '', access: 'run', inputSchema: {}, run: async (a) => (ran.push(String(a.block ?? '*')), 'ok') }], [{ path: 'T.md', block: 'search' }])
    await expect(tools[0].run({ path: 'T', block: 'search' })).rejects.toThrow(/запускает harness/)
    await expect(tools[0].run({ path: 'T.md' })).rejects.toThrow(/запускает harness/)
    await expect(tools[0].run({ path: 'T.md', block: 'other' })).resolves.toBe('ok')
    expect(ran).toEqual(['other'])
  })
})
