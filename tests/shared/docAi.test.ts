import { describe, expect, it } from 'vitest'
import { cleanMemory, docAiOf, docTurnOf, DOC_MEMORY_MAX, DOC_TURNS_MAX, linesChanged, memoryForAgent, memoryRewrite, withTurn, type DocTurn } from '../../src/shared/agent/docAi'
import { buildPack } from '../../src/shared/agent/contextPack'
import { SharedText } from '../../src/shared/transport/sharedText'

const turn = (id: string, extra: Partial<Parameters<typeof docTurnOf>[0]> = {}): DocTurn =>
  docTurnOf({ id, at: 1, ms: 1500.4, agent: 'ИИ · Анна', owner: 'Анна', asker: 'Борис', question: '  что   по задаче?  ', trace: [], wrote: 0, ...extra })

describe('the memory written by several people’s AIs', () => {
  it('a rewrite over the version one saw — kept, a newer version; over a version changed meanwhile — refused', () => {
    const first = memoryRewrite(undefined, 0, 'цель: релиз', 'ИИ · Анна', true, 100)
    expect(first).toMatchObject({ text: 'цель: релиз', by: 'ИИ · Анна', agent: true, at: 100 })
    // Борис's AI saw the memory before Анна's rewrite: refused (Анна's words are never lost)
    expect(memoryRewrite(first, 0, 'цель: тесты', 'ИИ · Борис', true, 120)).toBeUndefined()
    // over the fresh one — kept; the clock behind — still a newer version
    const next = memoryRewrite(first, first!.at, 'цель: релиз\nтесты: Борис', 'ИИ · Борис', true, 50)
    expect(next!.at).toBeGreaterThan(first!.at)
  })
})

describe('the AI’s part of a document', () => {
  it('a turn as the journal keeps it: tools counted, the outcome, the question squeezed', () => {
    const t = docTurnOf({ id: 't', at: 1, ms: 2000, agent: 'A', owner: 'O', asker: 'B', question: 'x', trace: [{ tool: 'doc_read', args: '', ok: true, result: '' }, { tool: 'doc_read', args: '', ok: true, result: '' }, { tool: 'doc_edit', args: '', ok: true, result: '' }], wrote: 3, memory: true })
    expect(t).toMatchObject({ tools: { doc_read: 2, doc_edit: 1 }, outcome: 'ok', wrote: 3, memory: true })
    expect(turn('a').question).toBe('что по задаче?')
    expect(turn('b', { error: 'нет ключа' }).outcome).toBe('error')
    expect(turn('c', { stopped: true }).outcome).toBe('stopped')
  })
  it('the journal keeps the latest turns only, each once', () => {
    let list: DocTurn[] = []
    for (let i = 0; i < DOC_TURNS_MAX + 5; i++) list = withTurn(list, turn(`t${i}`))
    expect(list).toHaveLength(DOC_TURNS_MAX)
    expect(list[0].id).toBe('t5')
    expect(withTurn(list, turn('t44')).filter((x) => x.id === 't44')).toHaveLength(1)
  })
  it('the memory kept short; what another app wrote read safely', () => {
    expect(cleanMemory(`a\n\n\n\nb${'x'.repeat(DOC_MEMORY_MAX)}`).length).toBe(DOC_MEMORY_MAX)
    expect(cleanMemory('a\n\n\n\nb')).toBe('a\n\nb')
    expect(docAiOf({ memory: { text: 1 }, turns: [turn('ok'), { id: 5 }] })).toEqual({ turns: [turn('ok')] })
    expect(docAiOf(null)).toEqual({ turns: [] })
  })
  it('the lines a write changed', () => {
    expect(linesChanged('a\nb', 'a\nb\nc\n\nd')).toBe(2)
    expect(linesChanged('a\na', 'a\na\na')).toBe(1)
  })
  it('the memory goes into the prompt with a document; the tool told only when it may be changed', () => {
    const pack = (writable: boolean, doc = true) =>
      buildPack({ agentName: 'ИИ', owner: 'Анна', instructions: '', ...(doc ? { doc: { title: 'Д', path: 'Д.md', text: 'текст' } } : {}), links: [], folder: [], messages: [{ name: 'Борис', text: '?' }], question: 0, budget: 50_000, tools: true, memory: { memory: { text: '- цель: релиз', by: 'Анна', at: 1 }, writable } }).system
    expect(pack(true)).toContain('- цель: релиз')
    expect(pack(true)).toContain('doc_memory')
    expect(pack(false)).not.toContain('doc_memory')
    expect(pack(true, false)).not.toContain('цель: релиз')
    expect(memoryForAgent(undefined, true)).toContain('пока пусто')
    // the document wins over the memory and the earlier answers: a writer is told to fix the memory
    expect(memoryForAgent(undefined, true)).toMatch(/верь документу и поправь память/)
    expect(memoryForAgent(undefined, false)).toMatch(/верь документу/)
  })
  it('a shared note keeps it in its document: everyone’s turns kept, the oldest go', () => {
    const a = new SharedText()
    const b = new SharedText()
    a.onUpdate((u, o) => o === 'local' && b.apply(u, 'remote'))
    b.onUpdate((u, o) => o === 'local' && a.apply(u, 'remote'))
    a.setAiMemory({ text: 'память', by: 'Анна', at: 1 })
    b.pushAiTurn(turn('from-b'))
    a.pushAiTurn(turn('from-a'))
    expect(b.aiNow().memory?.text).toBe('память')
    expect(a.aiNow().turns.map((t) => t.id)).toEqual(['from-b', 'from-a'])
    for (let i = 0; i < DOC_TURNS_MAX; i++) a.pushAiTurn(turn(`x${i}`))
    expect(b.aiNow().turns).toHaveLength(DOC_TURNS_MAX)
  })
})
