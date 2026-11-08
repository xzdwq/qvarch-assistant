import { describe, expect, it } from 'vitest'
import { DEFAULT_HARNESS_LIMITS, REVIEWER_SELF } from '../../src/shared/agent/harness/constants'
import { advance, type HarnessEvent } from '../../src/shared/agent/harness/machine'
import { newRun, type CheckResult } from '../../src/shared/agent/harness/model'

const T0 = 1_800_000_000_000
const start = () => newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: REVIEWER_SELF, goal: 'Логи', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: false }, T0)
const plan = { steps: ['Логи'], criteria: [{ text: 'Логи читаются', check: { path: 'T.md', block: 'logs' }, step: 1 }] }
const checked = (r: CheckResult, body = 'B'): HarnessEvent => ({ kind: 'checked', results: new Map([[1, r]]), bodies: new Map([[1, body]]) })

describe('a check whose block waits for a person', () => {
  it('the run needs the person (the block and what it asked said); «Продолжить» — work goes on', () => {
    let run = advance(start(), { kind: 'turn', harness: { plan } }, T0 + 1).run
    expect(run.phase).toBe('baseline')
    const m = advance(run, checked({ ok: false, at: T0 + 2, error: 'Ждёт ввода человека: [sudo] password:', waiting: 'Оболочка «logs» — [sudo] password:' }), T0 + 2)
    expect(m.run.phase).toBe('help')
    expect(m.next).toEqual({ kind: 'wait' })
    expect(m.run.question).toMatch(/Оболочка «logs» — \[sudo\] password:.*ждёт ввода/)
    // (its result is not taken as the check's verdict: the block never got to the end)
    expect(m.run.criteria[0].result).toBeUndefined()
    run = advance(m.run, { kind: 'resume' }, T0 + 3).run
    expect(run.phase).toBe('work')
  })
})
