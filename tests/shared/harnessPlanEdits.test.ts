import { describe, expect, it } from 'vitest'
import { DEFAULT_HARNESS_LIMITS } from '../../src/shared/agent/harness/constants'
import { advance } from '../../src/shared/agent/harness/machine'
import { newRun, type HarnessRun } from '../../src/shared/agent/harness/model'
import { appliedDraft, draftWords, withoutDropped } from '../../src/shared/agent/harness/planDraft'
import { checkMet } from '../../src/shared/agent/harness/failures'

const planned = (): HarnessRun => {
  const run = newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: '', goal: 'G', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: true }, 0)
  const plan = {
    steps: ['Браузер', 'Матрица'],
    criteria: [{ text: 'Матрица прогнана', check: { path: 'T.md', block: 'search' }, step: 2 }, { text: 'Данные стенда не изменялись' }, { text: 'Отчёт в документе' }],
    guides: { work: ['testing'], check: ['testing-review'] },
  }
  return advance(run, { kind: 'turn', harness: { plan } }, 1).run
}

describe('a test looking for defects', () => {
  const findings = { ok: false, at: 1, error: 'Проверка «Матрица»: ответ 500', findings: true }
  it('found some (expect: complete): met — what it found is its result; broken — not met', () => {
    expect(checkMet({ id: 1, text: 't', check: { path: 'T.md', block: 'm' }, expect: 'complete', result: findings })).toBe(true)
    expect(checkMet({ id: 1, text: 't', check: { path: 'T.md', block: 'm' }, result: findings })).toBe(false)
    expect(checkMet({ id: 1, text: 't', check: { path: 'T.md', block: 'm' }, expect: 'complete', result: { ok: false, at: 1, error: 'Timeout' } })).toBe(false)
  })
  it('the agent says a red test is one looking for defects: the same block\'s result stands, the step goes on — nothing run again', () => {
    let run = planned()
    run = advance(run, { kind: 'confirm' }, 2).run
    run = advance(run, { kind: 'checked', results: new Map([[1, { ok: false, at: 2, missing: true }]]), bodies: new Map([[1, undefined]]) }, 3).run
    run = advance(advance(run, { kind: 'turn', harness: { report: { state: 'check', note: '', step: 2 } } }, 4).run, { kind: 'checked', results: new Map([[1, findings]]), bodies: new Map([[1, 'M']]) }, 5).run
    expect(run.fix).toContain('ответ 500')
    const m = advance(run, { kind: 'turn', harness: { report: { state: 'check', note: 'это дефект продукта', step: 2, checks: [{ criterion: 1, path: 'T.md', block: 'search', expect: 'complete' }] } } }, 6)
    expect(m.run.criteria[0]).toMatchObject({ expect: 'complete', result: findings, ranOn: 'M' })
    expect(m.next).toEqual({ kind: 'checks', baseline: false, ids: [1], fresh: false })
    // (the check reused — its result met now)
    const after = advance(m.run, { kind: 'checked', results: new Map([[1, findings]]), bodies: new Map([[1, 'M']]) }, 7)
    expect(after.next).toEqual({ kind: 'turn', mode: 'work' })
  })
})

describe('the plan as the person edited it', () => {
  it('«Начать» with the plan edited: taken as it is, no turn of the agent; a kept criterion keeps its check', () => {
    const run = planned()
    const m = advance(run, { kind: 'confirm', draft: { steps: ['Браузер', 'Матрица'], criteria: ['Матрица прогнана', 'Отчёт в документе'] } }, 2)
    expect(m.run.criteria.map((c) => c.text)).toEqual(['Матрица прогнана', 'Отчёт в документе'])
    expect(m.run.criteria[0].check).toEqual({ path: 'T.md', block: 'search' })
    // the checks before the work — not a turn of the agent
    expect(m.next).toEqual({ kind: 'checks', baseline: true, ids: [1], fresh: true })
  })
  it('a criterion edited where it stood keeps its check; a new one is the final check\'s', () => {
    const run = planned()
    const r = appliedDraft(run, { steps: ['Браузер'], criteria: ['Матрица прогнана по всем значениям', 'Новый'] })
    expect(r.criteria[0]).toMatchObject({ text: 'Матрица прогнана по всем значениям', check: { block: 'search' } })
    expect(r.criteria[0].step).toBeUndefined()
    expect(r.criteria[1].check).toBeUndefined()
  })
  it('«Начать» with what the agent is to take in: it plans by it — what the person took out never comes back — and the work goes on at once', () => {
    const run = planned()
    const asked = advance(run, { kind: 'replan', guides: { work: ['testing', 'big-data'], check: ['testing-review'] }, draft: { steps: ['Браузер', 'Матрица'], criteria: ['Матрица прогнана', 'Отчёт в документе'] }, remarks: 'без эталона', go: true }, 2)
    expect(asked.next).toEqual({ kind: 'turn', mode: 'plan' })
    expect(asked.run.hints.at(-1)).toMatch(/критерий удалён: «Данные стенда не изменялись»[\s\S]*без эталона/)
    // the agent brings it back anyway: kept out; and to work with no second «Начать»
    const plan = { steps: ['Браузер', 'Матрица'], criteria: [{ text: 'Матрица прогнана', check: { path: 'T.md', block: 'search' }, step: 2 }, { text: 'данные стенда  не изменялись' }, { text: 'Отчёт в документе' }], guides: { work: ['testing'], check: [] } }
    const m = advance(asked.run, { kind: 'turn', harness: { plan } }, 3)
    expect(m.run.criteria.map((c) => c.text)).toEqual(['Матрица прогнана', 'Отчёт в документе'])
    expect(m.run.guides).toEqual({ work: ['testing', 'big-data'], check: ['testing-review'] })
    expect(m.run.phase).toBe('baseline')
    expect(m.run.go).toBeUndefined()
  })
  it('no changes — no words; dropped ones filtered by text, case and spaces aside', () => {
    const run = planned()
    expect(draftWords(run, { steps: ['Браузер', 'Матрица'], criteria: run.criteria.map((c) => c.text) })).toBe('')
    expect(withoutDropped({ steps: ['A', 'b'], criteria: [{ text: ' X  y ' }, { text: 'z' }] }, { steps: ['B'], criteria: ['x Y'] })).toEqual({ steps: ['A'], criteria: [{ text: 'z' }] })
  })
})
