import { describe, expect, it } from 'vitest'
import { historyOf, postLocal, roomOfLocal, type LocalChat } from '../../src/shared/transport/localChat'
import { docLink, linkParts, parseDocLink } from '../../src/shared/notebook/links'

const ME = { id: 'dev-me', name: 'Виктор' }
const ID = '6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5'
const empty = (): LocalChat => ({ id: ID, title: 'Свой', agents: [{ id: 'dev-me:p1', name: 'ИИ · Виктор', owner: 'dev-me' }], messages: [], readSeq: 0 })

describe('a chat kept on this computer', () => {
  it('messages numbered in a row; one\'s own read, an agent\'s — not yet', () => {
    const a = postLocal(empty(), ME, { text: 'Вопрос', mentions: ['dev-me:p1'] }, 10)
    const b = postLocal(a.chat, ME, { text: 'Ответ', agent: { id: 'dev-me:p1', name: 'ИИ · Виктор' }, chain: 1 }, 20)
    expect(b.chat.messages.map((m) => m.seq)).toEqual([1, 2])
    expect(b.chat.readSeq).toBe(1)
    expect(roomOfLocal(b.chat, ME)).toMatchObject({ id: ID, members: [ME], lastSeq: 2, readSeq: 1, agents: empty().agents })
  })
  it('brought to the server as its history: each message by its own id, the agent by its id', () => {
    const a = postLocal(empty(), ME, { text: 'Вопрос' }, 10)
    const b = postLocal(a.chat, ME, { text: 'Ответ', agent: { id: 'dev-me:p1', name: 'ИИ · Виктор' }, chain: 1 }, 20)
    const h = historyOf(b.chat)
    expect(h).toHaveLength(2)
    expect(h[1]).toMatchObject({ text: 'Ответ', at: 20, agent: 'dev-me:p1', chain: 1 })
    expect(new Set(h.map((x) => x.clientId)).size).toBe(2)
  })
})

describe('links in a message', () => {
  it('parts: plain text and links to click (a note by its label, a shared note, a site)', () => {
    const doc = docLink('0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b', 'Сводка', 'ABCD-2345')
    const parts = linkParts(`См. [[Отчёт|отчёт]] и ${doc}, ещё [сайт](https://x.ru).`)
    expect(parts.map((p) => [p.text, p.link?.kind])).toEqual([
      ['См. ', undefined],
      ['отчёт', 'note'],
      [' и ', undefined],
      ['Сводка', 'doc'],
      [', ещё ', undefined],
      ['сайт', 'web'],
      ['.', undefined],
    ])
  })
  it("a shared note's link: its document and the code to join it by", () => {
    expect(parseDocLink('qvarch://doc/0B5F8C1E-2a3d-4e5f-9a8b-7c6d5e4f3a2b?join=ABCD-2345')).toEqual({ doc: '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b', join: 'ABCD-2345' })
    expect(parseDocLink('qvarch://doc/0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b')).toEqual({ doc: '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b' })
    expect(parseDocLink('qvarch://jira/ABC-1')).toBeUndefined()
  })
})
