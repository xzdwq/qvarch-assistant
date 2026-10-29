import { afterAll, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'node:fs'
import { docAiOf, docTurnOf, withTurn, type DocAi, type DocTurn } from '../../src/shared/agent/docAi'
import { keptSteps, laneOf, TRAJ_STEPS_MAX, TRAJ_TEXT_MAX, TRAJ_TURNS_KEPT, type TrajStep } from '../../src/shared/agent/trajectory'
import { timeBar, turnSteps } from '../../src/shared/agent/trajectoryView'
import { metaHits } from '../../src/shared/agent/docAiSearch'
import { TurnTrajectory } from '../../src/main/agent/turnTrajectory'
import { SharedStates } from '../../src/main/transport/sharedStates'
import { sharedMark } from '../../src/shared/transport/space'
import { testDir } from '../testTemp'

vi.mock('electron', () => ({ clipboard: {}, net: {}, shell: {} }))
const { Vault } = await import('../../src/main/vault')

const turn = (id: string, over: Partial<DocTurn> = {}): DocTurn => ({ id, at: 1000, ms: 4000, agent: 'ИИ', owner: 'Я', asker: 'Я', question: 'q', tools: {}, wrote: 0, outcome: 'ok', ...over })
const step = (kind: TrajStep['kind'], at: number, ms: number, text = 't'): TrajStep => ({ kind, at, ms, text })

describe('a turn’s trajectory as kept', () => {
  it('texts cut, a long turn — its beginning and its end', () => {
    const many = Array.from({ length: 60 }, (_, i) => step('tool', i, 1, `шаг ${i}`))
    const kept = keptSteps(many)
    expect(kept).toHaveLength(TRAJ_STEPS_MAX)
    expect(kept[0].text).toBe('шаг 0')
    expect(kept[kept.length - 1].text).toBe('шаг 59')
    expect(keptSteps([step('model', 0, 0, 'x'.repeat(1000))])[0].text.length).toBe(TRAJ_TEXT_MAX + 1)
  })
  it('only the latest turns keep their steps (a shared note’s journal goes to everyone)', () => {
    let turns: DocTurn[] = []
    for (let i = 0; i < TRAJ_TURNS_KEPT + 3; i++) turns = withTurn(turns, docTurnOf({ id: `t${i}`, at: i, ms: 1, agent: 'a', owner: 'o', asker: 'x', question: 'q', trace: [], wrote: 0, steps: [step('user', 0, 0)] }))
    expect(turns.filter((t) => t.steps).length).toBe(TRAJ_TURNS_KEPT)
    expect(turns[0].steps).toBeUndefined()
    expect(turns[turns.length - 1].steps).toHaveLength(1)
  })
  it('another app’s steps read safely: a broken one left out', () => {
    const ai = docAiOf({ turns: [{ ...turn('a'), steps: [step('model', 0, 5), { kind: 'nope', at: 0, ms: 0, text: '' }, 'x'] }] })
    expect(ai.turns[0].steps).toEqual([step('model', 0, 5)])
  })
  it('each kind on its lane', () => {
    expect([laneOf('context'), laneOf('model'), laneOf('tool'), laneOf('error')]).toEqual(['context', 'model', 'tools', 'model'])
  })
})

describe('the trajectory drawn', () => {
  it('an old turn (no steps) — from its summary', () => {
    const rows = turnSteps(turn('a', { question: 'что?', tools: { notes_search: 2, note_read: 1 }, outcome: 'error', error: 'нет ключа' }))
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'error'])
    expect(rows[1].text).toBe('notes_search ×2, note_read')
  })
  it('the bar: turns one after another, as long as they were (a short one still seen); steps inside their turn', () => {
    const b = timeBar([turn('a', { ms: 9000, steps: [step('model', 0, 4500), step('tool', 4500, 4500)] }), turn('b', { ms: 10 })])
    expect(b.turns[0].x).toBe(0)
    expect(b.turns[1].x).toBeCloseTo(b.turns[0].w)
    expect(b.turns[1].w).toBeGreaterThan(0.03)
    const [model, tool] = b.pieces
    expect(model).toMatchObject({ lane: 'model', x: 0 })
    expect(tool.lane).toBe('tools')
    expect(tool.x).toBeCloseTo(b.turns[0].w / 2)
  })
})

describe('a turn recorded step by step', () => {
  it('what it was given, each tool timed where it runs (failed ones too), how it ended', async () => {
    const t = new TurnTrajectory()
    t.given({ system: 'sys', prompt: 'p'.repeat(10), omitted: 0 }, 5, 'Вопрос', { memory: true, links: 2 })
    const [ok, bad] = t.timed([
      { name: 'note_read', description: '', inputSchema: {}, run: async () => 'текст' },
      { name: 'note_write', description: '', inputSchema: {}, run: async () => Promise.reject(new Error('нельзя')) },
    ] as never)
    await ok.run({ path: 'a.md' })
    await expect(bad.run({})).rejects.toThrow('нельзя')
    t.model({ text: '', calls: 2, ms: 3 })
    const steps = t.ended('Готово')
    expect(steps.map((s) => s.kind)).toEqual(['system', 'context', 'user', 'tool', 'tool', 'model', 'answer'])
    expect(steps[1].text).toContain('память документа')
    expect(steps[3]).toMatchObject({ tool: 'note_read', text: '{"path":"a.md"}', result: 'текст' })
    expect(steps[4]).toMatchObject({ tool: 'note_write', failed: true, result: 'нельзя' })
    expect(steps[5].text).toContain('только вызов инструментов')
  })
})

describe('the metadata searched', () => {
  const ai: DocAi = {
    memory: { text: 'Цель: выпуск релиза до пятницы', by: 'Я', at: 1 },
    turns: [turn('a', { question: 'проверь заказы', steps: [step('tool', 0, 1, '{"q":"orders"}'), step('answer', 1, 0, 'Заказы в порядке')] })],
  }
  it('the memory, the questions, the steps and answers — with where and the text around', () => {
    expect(metaHits(ai, 'релиз')[0]).toMatchObject({ where: 'memory' })
    expect(metaHits(ai, 'заказы').map((h) => h.where)).toEqual(['question', 'answer'])
    const h = metaHits(ai, 'ORDERS')[0]
    expect(h.where).toBe('step')
    expect(h.text.slice(h.at, h.at + h.len)).toBe('orders')
    expect(metaHits(ai, '   ')).toEqual([])
  })

  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
  it('the notes’ search finds by it: a personal note’s (its marks), a shared one’s (kept beside its state)', () => {
    const d = testDir('meta-')
    dirs.push(d)
    const v = new Vault(d, { onChange: () => undefined, onMedia: () => undefined })
    const states = new SharedStates(d, v.root)
    v.sharedMeta = (doc) => states.aiOf(doc)
    const doc = '0f8fad5b-d9cb-469f-a165-70867728950e'
    v.write('Личная.md', 'просто текст')
    v.setDocAi('Личная.md', ai)
    v.write('Общая.md', `${sharedMark(doc)}\nтекст`)
    states.save(doc, { state: '', text: '', ai: { turns: [turn('b', { question: 'где релиз?' })] } })
    const found = v.search('релиз')
    v.stop()
    expect(found.find((h) => h.path === 'Личная.md')?.meta?.[0].where).toBe('memory')
    expect(found.find((h) => h.path === 'Общая.md')?.meta?.[0].where).toBe('question')
  })
})
