import { describe, expect, it } from 'vitest'
import { componentCatalog, componentsGuide } from '../../src/notebook/blocks/catalog'
import { buildPack } from '../../src/shared/agent/contextPack'
import { editedText } from '../../src/main/agent/turnTools'

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

describe('doc_edit', () => {
  const text = '# Док\n\nЗадачи:\n- первая\n'
  it('a fragment replaced once, a line put after another, a text appended', () => {
    expect(editedText(text, { find: '- первая', replace: '- первая [AI-1 X](qvarch://jira/AI-1)' })).toContain('- первая [AI-1 X](qvarch://jira/AI-1)')
    expect(editedText(text, { after: 'Задачи:', text: '- новая' })).toBe('# Док\n\nЗадачи:\n- новая\n- первая\n')
    expect(editedText(text, { append: 'итог' })).toBe('# Док\n\nЗадачи:\n- первая\n\nитог\n')
  })
  it('a fragment met twice or never — said, nothing changed', () => {
    expect(() => editedText('a a', { find: 'a', replace: 'b' })).toThrow(/2 раз/)
    expect(() => editedText(text, { find: 'нет', replace: 'b' })).toThrow(/не найден/)
  })
})
