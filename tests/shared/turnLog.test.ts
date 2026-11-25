import { describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { keptSteps, TRAJ_STEPS_MAX, type TrajStep } from '../../src/shared/agent/trajectory'
import { journalStamp } from '../../src/shared/agent/trajectoryView'
import { fullStepOf, isTurnLogId, stepParts, turnLogOf, TURN_LOG_TEXT_MAX, TURN_LOGS_MAX, type TurnLog } from '../../src/shared/agent/turnLog'
import { TurnLogStore } from '../../src/main/agent/turnLogStore'
import { testDir } from '../testTemp'

const step = (kind: TrajStep['kind'], at: number, text: string, over: Partial<TrajStep> = {}): TrajStep => ({ kind, at, ms: 1, text, ...over })
const log = (steps: TrajStep[], over: Partial<TurnLog> = {}): TurnLog => ({ id: 't-1', at: 1, system: 'SYS', prompt: 'DOC', steps, ...over })

describe('a turn’s full record', () => {
  it('kept whole, only a huge text bounded; a malformed one refused', () => {
    const big = 'x'.repeat(TURN_LOG_TEXT_MAX + 1000)
    const r = turnLogOf(log([step('tool', 0, '{}', { tool: 'db_query', result: big }), { kind: 'nope' } as unknown as TrajStep]))!
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0].result!.startsWith('x'.repeat(TURN_LOG_TEXT_MAX) + '\n')).toBe(true)
    expect(r.steps[0].result).toContain(`всего ${big.length}`)
    expect(turnLogOf(log([step('user', 0, 'z'.repeat(5000))]))!.steps[0].text).toHaveLength(5000)
    expect(turnLogOf({ id: '../x', at: 1 })).toBeUndefined()
    expect(isTurnLogId('a1b2-c3')).toBe(true)
  })

  it('a journal step found in the record — in a short turn and at both ends of a long one', () => {
    const all = Array.from({ length: 60 }, (_, i) => step('tool', i, `полный ${i} ${'y'.repeat(400)}`, { tool: `t${i}` }))
    const kept = keptSteps(all)
    expect(kept).toHaveLength(TRAJ_STEPS_MAX)
    const rec = log(all)
    for (const i of [0, 20, TRAJ_STEPS_MAX - 7, TRAJ_STEPS_MAX - 6, TRAJ_STEPS_MAX - 1]) expect(fullStepOf(rec, i, kept)?.tool).toBe(kept[i].tool)
    const short = [step('system', 0, 's'), step('context', 0, 'c'), step('answer', 5, 'a')]
    expect(fullStepOf(log(short), 2, keptSteps(short))?.text).toBe('a')
    // (a record of another shape: nothing matched, never a wrong step)
    expect(fullStepOf(log([step('model', 0, 'm')]), 0, [step('tool', 0, 'x', { tool: 'a' })])).toBeUndefined()
  })

  it('a step’s parts say which way they went: the instructions and the tool’s answer — into the AI', () => {
    const rec = log([])
    const sys = stepParts(step('system', 0, 'Системная инструкция · 3 симв.'), undefined, rec)
    expect(sys).toEqual({ parts: [{ flow: 'toAi', what: 'системная инструкция', text: 'SYS' }], whole: true })
    expect(stepParts(step('context', 0, 'Контекст'), undefined, rec).parts[0].text).toBe('DOC')
    const t = stepParts(step('tool', 0, '{"sql":"…'), step('tool', 0, '{"sql":"select 1"}', { result: 'id\n1' }), rec)
    expect(t.parts.map((p) => [p.flow, p.text])).toEqual([
      ['fromAi', '{"sql":"select 1"}'],
      ['toAi', 'id\n1'],
    ])
    // (not on this computer: the journal's cut text, said not whole)
    expect(stepParts(step('model', 0, 'слова…'), undefined, undefined)).toEqual({ parts: [{ flow: 'fromAi', what: 'слова модели', text: 'слова…' }], whole: false })
  })

  it('the journal’s time: dd.mm.yy hh:mm:ss', () => {
    expect(journalStamp(new Date(2026, 10, 4, 9, 5, 7).getTime())).toBe('04.11.26 09:05:07')
  })

  it('the store keeps the latest records and reads them back', () => {
    const root = testDir('turnlogs')
    const store = new TurnLogStore(root)
    store.save(log([step('user', 0, 'вопрос')], { id: 'a' }))
    expect(store.get('a')?.steps[0].text).toBe('вопрос')
    expect(store.get('missing')).toBeUndefined()
    expect(store.get('../../etc')).toBeUndefined()
    for (let i = 0; i < TURN_LOGS_MAX + 3; i++) store.save(log([], { id: `n${i}` }))
    expect(readdirSync(join(root, 'agent-turns')).filter((f) => f.endsWith('.json')).length).toBe(TURN_LOGS_MAX)
  })
})
