import { describe, expect, it } from 'vitest'
import { ATTACH_MAX, feedSections, groupMessages, mergeRooms, type ChatMessage, type ChatRoom } from '../../src/shared/transport/chat'
import { attachOf, sendsUnrun, type HttpShot, type PwShot, type SqlShot } from '../../src/notebook/engine/chatAttach'
import { HIDDEN } from '../../src/notebook/engine/sharedRuns'

const msg = (seq: number, author: string, at: number, room = 'r'): ChatMessage => ({ room, seq, id: `${room}${seq}`, author: { id: author, name: author }, text: 't', at })
const room = (id: string, over: Partial<ChatRoom> = {}): ChatRoom => ({ id, title: id, members: [], lastSeq: 0, readSeq: 0, ...over })

describe('messages as a messenger shows them', () => {
  it('one author\'s messages within a minute — one group (a name over it, a tail under it)', () => {
    const list = [msg(1, 'a', 0), msg(2, 'a', 30_000), msg(3, 'a', 200_000), msg(4, 'b', 201_000)]
    expect(groupMessages(list)).toEqual([
      { first: true, last: false },
      { first: false, last: true },
      { first: true, last: true },
      { first: true, last: true },
    ])
  })
  it('a conversation and its branches as one feed, by time', () => {
    expect(mergeRooms([[msg(1, 'a', 10), msg(2, 'a', 30)], [msg(1, 'b', 20, 'branch')]]).map((m) => `${m.room}:${m.seq}`)).toEqual(['r:1', 'branch:1', 'r:2'])
  })
})

describe('the feed', () => {
  it('conversations with their branches (a branch\'s news lifts its conversation), the shared notes\' chats, the comments', () => {
    const rooms = [
      room('talk-old', { last: msg(1, 'a', 10) }),
      room('talk', { last: msg(1, 'a', 5) }),
      room('branch', { parent: 'talk', last: msg(1, 'a', 50) }),
      room('lost-branch', { parent: 'not-here', last: msg(1, 'a', 1) }),
      room('space-chat', { space: 's' }),
      room('comment', { space: 's', doc: 'd', anchor: { start: 'A', end: 'B', quote: 'q' } }),
    ]
    const s = feedSections(rooms)
    expect(s.talks.map((t) => [t.room.id, t.branches.map((b) => b.id)])).toEqual([
      ['talk', ['branch']],
      ['talk-old', []],
      ['lost-branch', []],
    ])
    expect(s.shared.map((r) => r.id)).toEqual(['space-chat'])
    expect(s.comments.map((r) => r.id)).toEqual(['comment'])
  })
})

describe('a block\'s result in a chat', () => {
  it('a request: its answer, the secret headers never in it', () => {
    const a = attachOf('http', { src: '', run: { state: 'ok', at: 1, request: { method: 'GET', url: 'https://app.example.com/x', headers: [['Authorization', 'Bearer s']], body: '', missing: [] }, response: { status: 200, statusText: 'OK', headers: [['Set-Cookie', 'k=v']], body: '{"ok":true}', time: 12, size: 11, url: 'u' } } }, 'HTTP')!
    expect(a.data as HttpShot).toMatchObject({ method: 'GET', status: 200, body: '{"ok":true}' })
    expect(JSON.stringify(a)).not.toMatch(/Bearer|k=v/)
    expect(HIDDEN).toBeTruthy()
  })
  it('a query\'s rows cut to fit a message, the total kept; nothing to send — none', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => [i, 'строка с текстом подлиннее']) as unknown[][]
    const a = attachOf('sql', { src: '', run: { state: 'ok', at: 1, table: { columns: [{ name: 'id' }, { name: 'name' }], rows, more: false, ms: 5 }, sql: { text: 'select', values: [], mode: 'run', db: 'x', missing: [] } } }, 'SQL')!
    const shot = a.data as SqlShot
    expect(shot.total).toBe(20_000)
    expect(shot.rows.length).toBeGreaterThan(0)
    expect(shot.rows.length).toBeLessThan(20_000)
    expect(JSON.stringify(a).length).toBeLessThanOrEqual(ATTACH_MAX)
    expect(attachOf('sql', { src: '', run: { state: 'ok', at: 1 } }, 'SQL')).toBeUndefined()
    expect(attachOf('sql', { src: '```sql\nselect 1\n```' }, 'SQL')).toBeUndefined()
  })
  it('a browser test goes as it is written — its whole block, no run needed, no result in it', () => {
    const src = "```pw name=login\nawait page.goto('https://app.example.com')\n```"
    expect(sendsUnrun('pw')).toBe(true)
    expect(sendsUnrun('sql')).toBe(false)
    expect(attachOf('pw', { src }, 'Playwright')!.data as PwShot).toEqual({ source: src })
    expect(attachOf('pw', { src, run: { state: 'error', at: 1, error: 'упал' } }, 'Playwright')!.data).toEqual({ source: src })
    expect(attachOf('pw', { src: '  ' }, 'Playwright')).toBeUndefined()
  })
  it('code goes with its code — and its value once it was run', () => {
    const src = '```ts run name=total\nreturn 1 + 2\n```'
    expect(sendsUnrun('code')).toBe(true)
    expect(attachOf('code', { src }, 'Код')!.data).toEqual({ source: src, hasValue: false })
    expect(attachOf('code', { src, run: { state: 'ok', at: 1, value: 3, hasValue: true } }, 'Код')!.data).toEqual({ source: src, hasValue: true, value: 3 })
  })
})
