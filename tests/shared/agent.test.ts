import { describe, expect, it } from 'vitest'
import { runAgentLoop, type ModelSession, type ModelStep } from '../../src/shared/agent/agentLoop'
import { buildPack, noteForAgent, type PackInput } from '../../src/shared/agent/contextPack'
import { readOpenAiReply, toolsRefused } from '../../src/shared/agent/openaiWire'
import { agentIdOf, cleanProfile, defaultAgentName, inFolders, ownerOfAgent, profileOfAgent } from '../../src/shared/agent/profiles'
import { agentsCalled, CHAIN_MAX } from '../../src/shared/agent/trigger'
import { mayUse } from '../../src/shared/agent/turn'
import { attachForAgent } from '../../src/shared/agent/attachLine'
import { linksIn, sectionOf } from '../../src/shared/notebook/links'
import { authorName, mentionable, mentionsIn, type ChatMessage, type ChatRoom } from '../../src/shared/transport/chat'

const ME = 'dev-me'
const OTHER = 'dev-other'
const MY_AGENT = agentIdOf(ME, 'p1')
const ITS_AGENT = agentIdOf(OTHER, 'p9')
const room = (over: Partial<ChatRoom> = {}): ChatRoom => ({
  id: 'r',
  title: 'Чат',
  members: [
    { id: ME, name: 'Виктор' },
    { id: OTHER, name: 'Анна' },
  ],
  lastSeq: 0,
  readSeq: 0,
  agents: [
    { id: MY_AGENT, name: 'ИИ · Виктор', owner: ME },
    { id: ITS_AGENT, name: 'ИИ · Анна', owner: OTHER },
  ],
  ...over,
})
const msg = (over: Partial<ChatMessage>): ChatMessage => ({ room: 'r', seq: 1, id: 'm1', author: { id: ME, name: 'Виктор' }, text: '', at: 1, ...over })

describe('links of a note', () => {
  it('every kind found in order, each once; code blocks skipped', () => {
    const text = [
      'См. [[Требования#Статусы|тут]] и [[Требования#Статусы]], ![[.images/a.png]]',
      '[ABC-1 Задача](qvarch://jira/ABC-1), [Встреча](qvarch://event/2026-10-20/e1)',
      '[Общая](qvarch://doc/0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b) [сайт](https://x.ru/a)',
      '```js',
      'const s = "[[Не ссылка]]"',
      '```',
    ].join('\n')
    expect(linksIn(text).map((l) => l.kind)).toEqual(['note', 'file', 'jira', 'event', 'doc', 'web'])
    expect(linksIn(text)[0]).toMatchObject({ target: 'Требования', section: 'Статусы', label: 'тут' })
  })
  it("a section: its heading's lines to the next heading of its level", () => {
    const text = '# A\nx\n## B\ny\n### C\nz\n## D\nw'
    expect(sectionOf(text, 'b')).toBe('## B\ny\n### C\nz')
    expect(sectionOf(text, 'нет')).toBeUndefined()
  })
})

describe("an agent's context", () => {
  const input = (over: Partial<PackInput> = {}): PackInput => ({
    agentName: 'ИИ · Виктор',
    owner: 'Виктор',
    instructions: 'Ты аналитик',
    doc: { title: 'Задача', path: 'Работа/Задача.md', text: '<!-- qa:shared doc=0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b -->\n# Задача\n```chat\nroom: r\n```\nТекст' },
    links: [{ raw: '[[Требования]]', says: 'заметка «Требования.md»' }],
    folder: ['Требования'],
    messages: [
      { name: 'Анна', text: 'Есть вопрос по статусам' },
      { name: 'ИИ · Анна', text: 'Статусов три' },
      { name: 'Виктор', text: '@ИИ · Виктор, напиши запрос' },
    ],
    question: 2,
    budget: 50_000,
    tools: true,
    ...over,
  })
  it('the note without its mark and chat blocks; the discussion as names and words; the question marked', () => {
    const p = buildPack(input())
    expect(noteForAgent(input().doc!.text)).toBe('# Задача\n[чат]\nТекст')
    expect(p.prompt).toContain('Анна: Есть вопрос по статусам\nИИ · Анна: Статусов три\n→ Виктор: @ИИ · Виктор, напиши запрос')
    expect(p.prompt).toContain('[[Требования]] → заметка «Требования.md»')
    expect(p.system).toContain('Ты аналитик')
    expect(p.omitted).toBe(0)
  })
  it('too long: the oldest messages left out (said how many), the note cut to its outline and start', () => {
    const messages = Array.from({ length: 300 }, (_v, i) => ({ name: 'Анна', text: `сообщение ${i} ${'х'.repeat(200)}` }))
    const big = `# Большой\n${'текст '.repeat(40_000)}\n## Хвост`
    const p = buildPack(input({ messages, question: 299, budget: 20_000, doc: { title: 'Б', path: 'Б.md', text: big } }))
    expect(p.omitted).toBeGreaterThan(200)
    expect(p.prompt).toContain(`[…ещё ${p.omitted} сообщений раньше — инструмент chat_history]`)
    expect(p.prompt).toContain('сообщение 299')
    expect(p.prompt).toContain('Оглавление:\n# Большой\n## Хвост')
    expect(p.prompt.length).toBeLessThan(40_000)
  })
})

describe('who an agent answers', () => {
  it("its owner's mention — always, with all its tools", () => {
    expect(agentsCalled(msg({ mentions: [MY_AGENT] }), room(), ME)).toEqual([{ agent: MY_AGENT, caller: 'owner' }])
  })
  it("someone else's mention — only when its owner lets others call it, with fewer tools", () => {
    const m = msg({ author: { id: OTHER, name: 'Анна' }, mentions: [MY_AGENT] })
    expect(agentsCalled(m, room(), ME)).toEqual([])
    const opened = room({ agents: room().agents!.map((a) => (a.id === MY_AGENT ? { ...a, open: true } : a)) })
    expect(agentsCalled(m, opened, ME)).toEqual([{ agent: MY_AGENT, caller: 'other' }])
  })
  it("another's agent is never run here; itself — never; a chain stops at its limit", () => {
    expect(agentsCalled(msg({ mentions: [ITS_AGENT] }), room(), ME)).toEqual([])
    expect(agentsCalled(msg({ agent: { id: MY_AGENT, name: 'x' }, mentions: [MY_AGENT] }), room(), ME)).toEqual([])
    const second = agentIdOf(ME, 'p2')
    const r = room({ agents: [...room().agents!, { id: second, name: 'ИИ 2', owner: ME }] })
    expect(agentsCalled(msg({ agent: { id: MY_AGENT, name: 'x' }, mentions: [second], chain: 1 }), r, ME)).toEqual([{ agent: second, caller: 'other' }])
    expect(agentsCalled(msg({ agent: { id: MY_AGENT, name: 'x' }, mentions: [second], chain: CHAIN_MAX }), r, ME)).toEqual([])
  })
  it('agents are mentioned like people; their messages carry their names', () => {
    expect(mentionsIn('@ИИ · Анна посмотри, @Анна тоже', mentionable(room()))).toEqual([ITS_AGENT, OTHER])
    expect(authorName(msg({ agent: { id: MY_AGENT, name: 'ИИ · Виктор' } }))).toBe('ИИ · Виктор')
  })
  it('someone else calling: reading and the shared note only', () => {
    expect(['read', 'doc', 'write', 'run'].map((a) => mayUse('other', a as 'read'))).toEqual([true, true, false, false])
    expect(mayUse('owner', 'run')).toBe(true)
  })
})

describe('the agent loop', () => {
  const session = (steps: ModelStep[]): ModelSession & { told: string[][] } => {
    const told: string[][] = []
    return { told, step: async () => steps.shift() ?? { text: 'конец', calls: [] }, answer: (r) => void told.push(r.map((x) => x.text)) }
  }
  it('tools called in order, their results (an error too) told back, the answer — the last words', async () => {
    const s = session([{ text: 'смотрю', calls: [{ id: '1', name: 'ok', input: { a: 1 } }, { id: '2', name: 'bad', input: {} }] }, { text: 'Готово', calls: [] }])
    const r = await runAgentLoop({ session: s, signal: new AbortController().signal, callTool: async (c) => (c.name === 'ok' ? 'данные' : Promise.reject(new Error('нельзя'))) })
    expect(r.text).toBe('Готово')
    expect(s.told).toEqual([['данные', 'нельзя']])
    expect(r.trace.map((t) => [t.tool, t.ok])).toEqual([
      ['ok', true],
      ['bad', false],
    ])
  })
  it('stops at its steps limit and when the model stops by itself', async () => {
    const forever = { text: '', calls: [{ id: 'x', name: 't', input: {} }] }
    const r = await runAgentLoop({ session: session(Array.from({ length: 10 }, () => ({ ...forever }))), signal: new AbortController().signal, callTool: async () => '', maxSteps: 3 })
    expect(r.note).toContain('3 шагов')
    const refused = await runAgentLoop({ session: session([{ text: '', calls: [], stopped: 'Модель отказалась отвечать' }]), signal: new AbortController().signal, callTool: async () => '' })
    expect(refused.note).toBe('Модель отказалась отвечать')
  })
})

describe('Chat Completions', () => {
  it('a reply with tool calls read (broken arguments — empty); the history keeps it', () => {
    const { step, message } = readOpenAiReply({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'notes_search', arguments: '{"query":"статус"}' } }, { id: 'c2', type: 'function', function: { name: 'doc_read', arguments: '{oops' } }] } }] })
    expect(step.calls).toEqual([
      { id: 'c1', name: 'notes_search', input: { query: 'статус' } },
      { id: 'c2', name: 'doc_read', input: {} },
    ])
    expect(message.tool_calls).toHaveLength(2)
  })
  it('a model refusing tools is told apart from other errors', () => {
    expect(toolsRefused(400, '{"error":{"message":"registry.ollama.ai/library/x does not support tools"}}')).toBe(true)
    expect(toolsRefused(401, 'invalid api key')).toBe(false)
  })
})

describe('agent profiles', () => {
  it('cleaned: unknown provider — Claude Code, no name — the default one, folders as paths', () => {
    const p = cleanProfile({ provider: 'nope', folders: ['\\Работа\\', ''], name: ' ' }, 'Виктор')
    expect(p).toMatchObject({ provider: 'claude-code', name: defaultAgentName('Виктор'), folders: ['Работа'] })
    expect(inFolders(p, 'Работа/Задача.md')).toBe(true)
    expect(inFolders(p, 'Личное/x.md')).toBe(false)
  })
  it("an agent's id: its owner and its profile", () => {
    expect(ownerOfAgent(MY_AGENT)).toBe(ME)
    expect(profileOfAgent(MY_AGENT)).toBe('p1')
  })
  it('an attachment said to an agent; its own steps — nothing', () => {
    expect(attachForAgent({ kind: 'sql', title: 'rows', data: { sql: 'select 1', columns: ['a'], rows: [[1]], total: 1 } })).toContain('select 1')
    expect(attachForAgent({ kind: 'trace', title: 'Шаги', data: [] })).toBe('')
  })
})
