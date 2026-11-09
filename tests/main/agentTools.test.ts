import { describe, expect, it } from 'vitest'
import { componentCatalog, componentsGuide } from '../../src/notebook/blocks/catalog'
import { buildPack } from '../../src/shared/agent/contextPack'
import { applyEdits, editsOf, EDITS_MAX } from '../../src/shared/agent/textEdits'

describe('what an agent is told of the app', () => {
  it('the components come from the registry: the work one with its periods and sample; a recording or a chat — not the agent’s', () => {
    const kinds = componentCatalog().map((c) => c.kind)
    expect(kinds).toEqual(expect.arrayContaining(['work', 'chart', 'table', 'callout', 'http', 'sql']))
    expect(kinds).not.toContain('chat')
    expect(kinds).not.toContain('audio')
    const work = componentsGuide('work')
    expect(work).toContain('```work')
    expect(work).toContain('last-week')
  })
  it('the prompt names the components and how links are written', () => {
    const p = buildPack({ agentName: 'ИИ', owner: 'o', instructions: '', links: [], folder: [], messages: [{ name: 'o', text: 'q' }], question: 0, budget: 50_000, tools: true, components: '- Работа (work)' })
    expect(p.system).toContain('- Работа (work)')
    expect(p.system).toContain('qvarch://jira/KEY-1')
  })
})

describe('doc_edit / note_edit: pinpoint edits', () => {
  const text = '# Док\n\nЗадачи:\n- первая\n'
  const edited = (t: string, a: Record<string, unknown>) => applyEdits(t, editsOf(a), 'перечитай')
  it('a fragment replaced once, a line put after another, a text appended', () => {
    expect(edited(text, { find: '- первая', replace: '- первая [AI-1 X](qvarch://jira/AI-1)' })).toContain('- первая [AI-1 X](qvarch://jira/AI-1)')
    expect(edited(text, { after: 'Задачи:', text: '- новая' })).toBe('# Док\n\nЗадачи:\n- новая\n- первая\n')
    expect(edited(text, { append: 'итог' })).toBe('# Док\n\nЗадачи:\n- первая\n\nитог\n')
  })
  it('a fragment met twice or never — said, nothing changed', () => {
    expect(() => edited('a a', { find: 'a', replace: 'b' })).toThrow(/2 раз/)
    expect(() => edited(text, { find: 'нет', replace: 'b' })).toThrow(/не найден — перечитай/)
  })
  it('the new text is kept as written: «$&», «$$», «$1» are not replacement patterns', () => {
    expect(edited('let a = X', { find: 'X', replace: '`${a}$$ $& $1`' })).toBe('let a = `${a}$$ $& $1`')
  })
  it('several edits in one call — in order, each over the text the previous left', () => {
    const out = edited(text, { edits: [{ find: '- первая', replace: '- первая\n- вторая' }, { after: '- вторая', text: '- третья' }, { append: 'итог' }] })
    expect(out).toBe('# Док\n\nЗадачи:\n- первая\n- вторая\n- третья\n\nитог\n')
  })
  it('the call’s own fields go first, then its edits', () => {
    expect(edited('a b', { find: 'a', replace: 'c', edits: [{ find: 'c', replace: 'd' }] })).toBe('d b')
  })
  it('one edit that does not fit — none applied, the one named by its number', () => {
    expect(() => edited(text, { edits: [{ find: '- первая', replace: '- 1' }, { find: 'нет', replace: 'x' }] })).toThrow(/Правка 2 из 2: Фрагмент find не найден.*Ничего не изменено/)
  })
  it('nothing asked, an empty list, a wrong item, too many — refused; a change to the same text — said', () => {
    expect(() => edited(text, {})).toThrow(/Нечего менять/)
    expect(() => edited(text, { edits: [] })).toThrow(/Нечего менять/)
    expect(() => edited(text, { after: 'Задачи:' })).toThrow(/Нечего менять/)
    expect(() => edited(text, { edits: 'x' })).toThrow(/список/)
    expect(() => edited(text, { edits: [1] })).toThrow(/Правка 1 — не объект/)
    expect(() => edited(text, { edits: [{ text: 'x' }, { append: 'y' }] })).toThrow(/Правка 1 из 2: Нечего менять/)
    expect(() => edited(text, { edits: Array.from({ length: EDITS_MAX + 1 }, () => ({ append: 'x' })) })).toThrow(/больше/)
    expect(() => edited(text, { find: '- первая', replace: '- первая' })).toThrow(/ничего не меняют/)
  })
})
