import { describe, expect, it } from 'vitest'
import { DEFAULT_HARNESS_LIMITS, REVIEWER_OFF, REVIEWER_SELF } from '../../src/shared/agent/harness/constants'
import { advance, type HarnessEvent } from '../../src/shared/agent/harness/machine'
import { newRun, type CheckResult, type HarnessRun } from '../../src/shared/agent/harness/model'
import { harnessInText, planOf, reportOf } from '../../src/shared/agent/harness/report'
import { failureSignature } from '../../src/shared/agent/harness/failures'
import { harnessBrief } from '../../src/shared/agent/harness/prompt'
import { endMessage } from '../../src/shared/agent/harness/milestones'

const T0 = 1_000_000
const start = (o: Partial<HarnessRun> = {}) => ({ ...newRun({ id: 'h', room: 'r', agent: 'a', agentName: 'ИИ', profile: 'p', reviewer: REVIEWER_SELF, goal: 'Сделать форму', limits: DEFAULT_HARNESS_LIMITS, confirmPlan: false }, T0), ...o })
const plan = { steps: ['Разметка', 'Сохранение'], criteria: [{ text: 'Форма сохраняется', check: { path: 'Тесты.md', block: 'save' }, step: 1 }, { text: 'Понятные подписи' }] }
const turn = (h: HarnessEvent & { kind: 'turn' }) => h
const report = (state: 'continue' | 'check' | 'done' | 'help', note = '', extra = {}) => turn({ kind: 'turn', harness: { report: { state, note, ...extra } } })
const checked = (ok: boolean, error = '', body = 'B'): HarnessEvent => ({ kind: 'checked', results: new Map<number, CheckResult>([[1, { ok, at: T0, ...(error ? { error } : {}) }]]), bodies: new Map([[1, body]]) })

/** Events applied in turn: the run and what each said next. */
function play(run: HarnessRun, ...events: HarnessEvent[]) {
  const nexts: string[] = []
  for (const e of events) {
    const m = advance(run, e, T0 + 1000)
    run = m.run
    nexts.push(m.next.kind === 'turn' ? `turn:${m.next.mode}` : m.next.kind === 'checks' ? `checks:${m.next.baseline ? 'base' : 'step'}` : m.next.kind)
  }
  return { run, nexts }
}

describe('harness course', () => {
  it('goes plan → baseline → work → checks → review → done', () => {
    const { run, nexts } = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(false, 'нет кнопки'), report('check', 'разметка готова', { step: 1 }), checked(true), report('done', 'всё'), checked(true), report('done', 'принято'))
    expect(nexts).toEqual(['checks:base', 'turn:work', 'checks:step', 'turn:work', 'checks:step', 'turn:review', 'end'])
    expect(run.phase).toBe('done')
    expect(run.stop).toBe('done')
    expect(run.criteria[0].baseline?.ok).toBe(false)
    expect(run.steps.every((s) => s.state === 'done')).toBe(true)
  })
  it('waits for the person when the plan is to be confirmed; a remark plans anew', () => {
    const r = play(start({ confirmPlan: true }), turn({ kind: 'turn', harness: { plan } }))
    expect(r.nexts).toEqual(['wait'])
    expect(r.run.phase).toBe('confirm')
    expect(play(r.run, { kind: 'confirm' }).nexts).toEqual(['checks:base'])
    const again = play(r.run, { kind: 'hint', text: 'добавь шаг про ошибки' })
    expect(again.nexts).toEqual(['turn:plan'])
    expect(again.run.hints).toEqual(['добавь шаг про ошибки'])
  })
  it('fixes a failed check, then stops when the same failure repeats', () => {
    const base = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true)).run
    const once = play(base, report('check'), checked(false, 'Timeout 3000ms exceeded'))
    expect(once.nexts).toEqual(['checks:step', 'turn:fix'])
    expect(once.run.fix).toContain('Timeout 3000ms')
    expect(once.run.steps[0].state).toBe('failed')
    // (the numbers differ — the same failure)
    const stuck = play(once.run, report('check'), checked(false, 'Timeout 5000ms exceeded'), report('check'), checked(false, 'Timeout 4000ms exceeded'))
    expect(stuck.nexts.at(-1)).toBe('end')
    expect(stuck.run.stop).toBe('stuck')
  })
  it('asks the person when the agent changed a check', () => {
    const base = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(false, 'x', 'BODY')).run
    const bent = play(base, report('check'), checked(true, '', 'BODY changed'))
    expect(bent.run.phase).toBe('help')
    expect(bent.run.stop).toBe('help')
    // «Продолжить»: the check as it is now is taken
    const on = play(bent.run, { kind: 'resume' }, report('check'), checked(true, '', 'BODY changed'))
    expect(on.nexts).toEqual(['turn:work', 'checks:step', 'turn:work'])
  })
  it('goes on after the person answers the question', () => {
    const base = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true)).run
    const asked = play(base, report('help', '', { question: 'Какой адрес стенда?' }))
    expect(asked.nexts).toEqual(['wait'])
    expect(asked.run.question).toBe('Какой адрес стенда?')
    const answered = play(asked.run, { kind: 'hint', text: 'адрес в документе' })
    expect(answered.nexts).toEqual(['turn:work'])
    expect(answered.run.hints).toEqual(['адрес в документе'])
    // the next turn heard it
    expect(play(answered.run, { ...report('continue'), heard: 1 }).run.hints).toEqual([])
  })
  it('the review turns the work back only naming criteria unmet — once; again — the person decides', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done'), checked(true), report('continue', 'подписи непонятные', { unmet: [2] }))
    expect(r.nexts.slice(-2)).toEqual(['turn:review', 'turn:fix'])
    expect(r.run.fix).toMatch(/2\. Понятные подписи[\s\S]*подписи непонятные/)
    const again = play(r.run, report('done'), checked(true), report('continue', 'всё ещё', { unmet: [2] }))
    expect(again.nexts.at(-1)).toBe('wait')
    expect(again.run.stop).toBe('help')
    expect(again.run.question).toMatch(/снова не принимает/)
    // the person answers: one more round is theirs to give
    expect(play(again.run, { kind: 'hint', text: 'доделай подписи' }).nexts).toEqual(['turn:work'])
  })
  it('with no final review the checks passed at the end are the end', () => {
    const r = play(start({ reviewer: REVIEWER_OFF }), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done', 'всё'), checked(true))
    expect(r.nexts.at(-1)).toBe('end')
    expect(r.run.stop).toBe('done')
    expect(r.run.steps.every((s) => s.state === 'done')).toBe(true)
  })
  it('values doubted run anew in the next checks — once; the review then looks again', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done'), checked(true))
    const m = advance(r.run, report('continue', 'сомнительный результат', { recheck: ['пусто', '<b>'] }), T0 + 2000)
    expect(m.next).toMatchObject({ kind: 'checks', baseline: false, recheck: ['пусто', '<b>'] })
    expect(m.run.finishing).toBe(true)
    const after = play(m.run, checked(true))
    expect(after.nexts).toEqual(['turn:review'])
    expect(after.run.recheck).toBeUndefined()
    // a second doubt: the person decides
    expect(play(after.run, report('continue', 'всё ещё', { recheck: ['пусто'] })).run.stop).toBe('help')
  })
  it('the agent may ask values run anew in its report', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true))
    const m = advance(r.run, report('check', 'поправил запрос', { step: 1, recheck: ['пусто'] }), T0 + 2000)
    expect(m.next).toMatchObject({ kind: 'checks', recheck: ['пусто'] })
    expect(reportOf({ state: 'check', note: '', recheck: [' пусто ', 'пусто', 5, null] })).toMatchObject({ recheck: ['пусто', '5'] })
  })
  it('the end says what each criterion rests on: a block, the review, or only the agent’s word', () => {
    const off = play(start({ reviewer: REVIEWER_OFF }), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done'), checked(true)).run
    expect(off.log.at(-1)!.text).toBe('Готово: проверено блоками — 1; без проверки, по отчёту ИИ — 1')
    expect(endMessage(off)).toMatch(/Понятные подписи — без проверки, по отчёту ИИ/)
    const reviewed = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done'), checked(true), report('done', 'принято')).run
    expect(reviewed.log.at(-1)!.text).toBe('Готово: проверено блоками — 1; принято финальной проверкой — 1')
  })
  it('settings set in the chat hold from now on: the review turned off mid-work ends it at the checks', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true))
    const s = advance(r.run, { kind: 'settings', settings: { reviewer: REVIEWER_OFF, limits: { ...DEFAULT_HARNESS_LIMITS, iterations: 3 }, confirmPlan: false } }, T0 + 2000)
    expect(s.next.kind).toBe('none')
    expect(s.run.limits.iterations).toBe(3)
    expect(play(s.run, report('done'), checked(true)).run.stop).toBe('done')
  })
  it('remarks with no criterion unmet are advice: the work is done', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true), report('done'), checked(true), report('continue', 'можно бы ещё измерить время'))
    expect(r.run.stop).toBe('done')
    expect(r.run.log.some((l) => /рекомендации[\s\S]*измерить время/.test(l.text))).toBe(true)
  })
  it('keeps to the limits: iterations, time, silence, errors', () => {
    const base = play(start({ limits: { ...DEFAULT_HARNESS_LIMITS, iterations: 2 } }), turn({ kind: 'turn', harness: { plan } }), checked(true)).run
    expect(play(base, report('continue'), report('continue')).run.stop).toBe('iterations')
    const late = advance({ ...base, limits: { ...base.limits, minutes: 1 } }, report('continue'), T0 + 61_000)
    expect(late.run.stop).toBe('time')
    const silent = play(base, turn({ kind: 'turn' }))
    expect(silent.nexts).toEqual(['turn:fix'])
    expect(play(silent.run, turn({ kind: 'turn' })).run.stop).toBe('silent')
    const err = play(base, turn({ kind: 'turn', error: 'нет связи' }), turn({ kind: 'turn', error: 'нет связи' }))
    expect(err.nexts).toEqual(['turn:work', 'end'])
    expect(err.run.stop).toBe('errors')
  })
  it('a resumed run has its limits anew; stopped and interrupted end it', () => {
    const base = play(start({ limits: { ...DEFAULT_HARNESS_LIMITS, iterations: 1 } }), turn({ kind: 'turn', harness: { plan } }), checked(true)).run
    const out = play(base, report('continue'))
    expect(out.run.stop).toBe('iterations')
    expect(play(out.run, { kind: 'resume' }).nexts).toEqual(['turn:work'])
    expect(play(base, { kind: 'stop' }).run.stop).toBe('stopped')
    expect(play(base, { kind: 'interrupted' }).run.stop).toBe('interrupted')
    expect(play(base, turn({ kind: 'turn', stopped: true })).run.stop).toBe('stopped')
  })
  it('with no checks: a step done goes on, done goes to the review', () => {
    const p = { steps: ['Текст'], criteria: [{ text: 'Понятно' }] }
    const r = play(start(), turn({ kind: 'turn', harness: { plan: p } }), report('check', '', { step: 1 }), report('done'))
    expect(r.nexts).toEqual(['turn:work', 'turn:work', 'turn:review'])
    expect(r.run.steps[0].state).toBe('done')
  })
  it('checks after a step only what is due by it; at the end — all (a passed unchanged one stands)', () => {
    const p = { steps: ['a', 'b'], criteria: [{ text: 'x', check: { path: 'T.md', block: 'x' }, step: 1 }, { text: 'y', check: { path: 'T.md', block: 'y' }, step: 2 }, { text: 'z', check: { path: 'T.md', block: 'z' } }] }
    let run = advance(start(), turn({ kind: 'turn', harness: { plan: p } }), 1).run
    const base = advance(run, { kind: 'checked', results: new Map(), bodies: new Map() }, 2)
    run = base.run
    const afterOne = advance(run, report('check', '', { step: 1 }), 3)
    expect(afterOne.next).toEqual({ kind: 'checks', baseline: false, ids: [1], fresh: false })
    run = advance(afterOne.run, { kind: 'checked', results: new Map([[1, { ok: true, at: 4 }]]), bodies: new Map([[1, 'X']]) }, 4).run
    expect(advance(run, report('check', '', { step: 2 }), 5).next).toEqual({ kind: 'checks', baseline: false, ids: [1, 2], fresh: false })
    expect(advance(run, report('done'), 5).next).toEqual({ kind: 'checks', baseline: false, ids: [1, 2, 3], fresh: false })
  })
  it('a criterion red but not due yet is not this step’s failure', () => {
    const p = { steps: ['a', 'b'], criteria: [{ text: 'x', check: { path: 'T.md', block: 'x' }, step: 1 }, { text: 'y', check: { path: 'T.md', block: 'y' }, step: 2 }] }
    const run = advance(advance(start(), turn({ kind: 'turn', harness: { plan: p } }), 1).run, { kind: 'checked', results: new Map([[1, { ok: false, at: 1 }], [2, { ok: false, at: 1 }]]), bodies: new Map() }, 2).run
    const m = advance(advance(run, report('check', '', { step: 1 }), 3).run, { kind: 'checked', results: new Map([[1, { ok: true, at: 4 }]]), bodies: new Map([[1, 'X']]) }, 4)
    expect(m.next).toEqual({ kind: 'turn', mode: 'work' })
    expect(m.run.steps[0].state).toBe('done')
  })
  it('a check the agent writes in the work is its own to change; one given before is guarded', () => {
    const p = { steps: ['a'], criteria: [{ text: 'x', check: { path: 'T.md', block: 'x' }, step: 1 }] }
    // (no block before the work: the agent writes it)
    let run = advance(advance(start(), turn({ kind: 'turn', harness: { plan: p } }), 1).run, { kind: 'checked', results: new Map([[1, { ok: false, at: 1, error: 'нет блока' }]]), bodies: new Map([[1, undefined]]) }, 2).run
    run = advance(advance(run, report('check'), 3).run, { kind: 'checked', results: new Map([[1, { ok: false, at: 3 }]]), bodies: new Map([[1, 'v1']]) }, 3).run
    const m = advance(advance(run, report('check'), 4).run, { kind: 'checked', results: new Map([[1, { ok: true, at: 4 }]]), bodies: new Map([[1, 'v2']]) }, 4)
    expect(m.run.phase).toBe('work')
    expect(m.run.criteria[0].ranOn).toBe('v2')
  })
  it('a check block not written yet is not a failure before the work; the agent puts its own check on its block', () => {
    const p = { steps: ['a'], criteria: [{ text: 'x', check: { path: 'T.md', block: 'wrongName' }, step: 1 }] }
    let run = advance(start(), turn({ kind: 'turn', harness: { plan: p } }), 1).run
    run = advance(run, { kind: 'checked', results: new Map([[1, { ok: false, at: 1, error: 'нет блока', missing: true }]]), bodies: new Map([[1, undefined]]) }, 2).run
    expect(run.log.at(-1)?.text).toMatch(/блоков проверок ещё нет: 1/)
    expect(harnessBrief(run, 'work', 3)).toMatch(/блока ещё нет/)
    const m = advance(run, report('check', '', { step: 1, checks: [{ criterion: 1, path: 'T.md', block: 'search_matrix' }] }), 3)
    expect(m.run.criteria[0].check).toEqual({ path: 'T.md', block: 'search_matrix' })
    expect(m.run.criteria[0].result).toBeUndefined()
    expect(m.next).toEqual({ kind: 'checks', baseline: false, ids: [1], fresh: false })
  })
  it('a check given before the work is not moved to another block', () => {
    const run = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(true, '', 'B')).run
    const m = advance(run, report('continue', '', { checks: [{ criterion: 1, path: 'T.md', block: 'other' }] }), 3)
    expect(m.run.criteria[0].check?.block).toBe('save')
    expect(m.run.log.some((l) => /не перепривязана/.test(l.text))).toBe(true)
  })
  it('refuses a section title as a block name', () => {
    const latin = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s)
    expect(planOf({ steps: ['a'], criteria: [{ text: 'x', path: 'T', block: 'Поиск — матрица' }] }, { nameOk: latin })).toMatch(/name=/)
    expect(reportOf({ state: 'check', note: '', checks: [{ criterion: 1, path: 'T', block: 'search_matrix' }] }, latin)).toMatchObject({ checks: [{ criterion: 1, path: 'T.md', block: 'search_matrix' }] })
  })
  it('tells the turn where the work stands', () => {
    const r = play(start(), turn({ kind: 'turn', harness: { plan } }), checked(false, 'нет')).run
    const brief = harnessBrief(r, 'work', T0 + 1000)
    expect(brief).toContain('Цель: Сделать форму')
    expect(brief).toContain('○ 1. Разметка')
    expect(brief).toContain('[save в Тесты.md, с шага 1] — не проходит')
    expect(brief).toContain('Текущий шаг 1')
  })
})

describe('harness reports', () => {
  it('reads the plan and says what is wrong in it', () => {
    expect(planOf({ steps: ['a'], criteria: ['b'] })).toEqual({ steps: ['a'], criteria: [{ text: 'b' }], guides: { work: [], check: [] } })
    expect(planOf({ steps: ['a'], criteria: [{ text: 'b', path: 'Тесты', block: 'save' }] })).toMatchObject({ criteria: [{ check: { path: 'Тесты.md', block: 'save' } }] })
    expect(planOf({ steps: [], criteria: ['b'] })).toMatch(/шаг/)
    expect(planOf({ steps: ['a'], criteria: [{ text: 'b', path: 'x' }] })).toMatch(/path и block/)
    expect(reportOf({ state: 'nope' })).toMatch(/state/)
    expect(reportOf({ state: 'help' })).toMatch(/вопрос/)
    expect(reportOf({ state: 'check', note: 'ok', step: 2 })).toEqual({ state: 'check', note: 'ok', step: 2 })
  })
  it('reads the block at the end of a text of a model with no tools', () => {
    const r = harnessInText('Сделал разметку.\n\n```harness\n{"state":"check","note":"разметка","step":1}\n```\n')
    expect(r.text).toBe('Сделал разметку.')
    expect(r.harness?.report).toMatchObject({ state: 'check', step: 1 })
    expect(harnessInText('```harness\n{"steps":["a"],"criteria":["b"]}\n```').harness?.plan?.steps).toEqual(['a'])
    expect(harnessInText('просто ответ').harness).toBeUndefined()
    expect(harnessInText('```harness\n{broken\n```').harness).toBeUndefined()
  })
  it('tells failures apart by meaning, not by numbers and ids', () => {
    const c = (id: number, error: string) => ({ id, text: 't', check: { path: 'p', block: 'b' }, result: { ok: false, at: 0, error } })
    expect(failureSignature([c(1, 'Timeout 3000ms at line 4')])).toBe(failureSignature([c(1, 'Timeout 5000ms at line 9')]))
    expect(failureSignature([c(1, 'Timeout')])).not.toBe(failureSignature([c(2, 'Timeout')]))
  })
})
