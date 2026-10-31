import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatRoom, Outgoing } from '../../src/shared/transport/chat'
import { cacheOf, isChatCacheData, isWaitingSeq, nextWaitingSeq, replySeqFor, waitingMessage } from '../../src/shared/transport/chatOffline'

const me = { id: 'dev-1', name: 'Я' }
const room = (id: string, at: number, lastSeq = 3): ChatRoom => ({ id, title: id, members: [me], lastSeq, readSeq: lastSeq, last: { room: id, seq: lastSeq, id: `${id}-m`, author: me, text: 'x', at } })
const msg = (room: string, seq: number, text = 'привет'): ChatMessage => ({ room, seq, id: `${room}-${seq}`, author: me, text, at: seq })

describe('chat with no server', () => {
  it('numbers the waiting messages after the room, never as the server would', () => {
    const r = { lastSeq: 12 }
    const a = nextWaitingSeq(r, [])
    const b = nextWaitingSeq(r, [{ pseq: a }])
    expect(a).toBeGreaterThan(12)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(13)
    expect(isWaitingSeq(a) && isWaitingSeq(b)).toBe(true)
    expect(isWaitingSeq(12)).toBe(false)
  })
  it('never gives a whole number however many wait', () => {
    let waiting: Array<{ pseq: number }> = []
    for (let i = 0; i < 1200; i++) waiting = [...waiting, { pseq: nextWaitingSeq({ lastSeq: 5 }, waiting) }]
    expect(waiting.every((w) => isWaitingSeq(w.pseq))).toBe(true)
    expect(new Set(waiting.map((w) => w.pseq)).size).toBe(waiting.length)
  })
  it('shows an agent answer waiting as the agent message', () => {
    const o: Outgoing = { room: 'r', clientId: 'c-1', text: 'ответ', at: 5, pseq: 3.001, agent: { id: 'dev-1:p', name: 'ИИ' }, chain: 1, reply: { seq: 3.0005, author: 'Я', text: 'вопрос' } }
    const m = waitingMessage(o, me)
    expect(m).toMatchObject({ id: 'c-1', clientId: 'c-1', seq: 3.001, agent: { name: 'ИИ' }, chain: 1, author: me })
  })
  it('sends an answer with the number its question got from the server', () => {
    const sent = new Map([[3.001, 4]])
    expect(replySeqFor({ seq: 3.001, author: 'Я', text: '' }, sent)).toBe(4)
    expect(replySeqFor({ seq: 2, author: 'Я', text: '' }, sent)).toBe(2)
    // (its question forgotten over a restart: it goes without the quote)
    expect(replySeqFor({ seq: 3.002, author: 'Я', text: '' }, sent)).toBeUndefined()
    expect(replySeqFor(undefined, sent)).toBeUndefined()
  })
  it('keeps the rooms with the latest talk first, within the size', () => {
    const rooms = [room('old', 1), room('new', 9)]
    const messages: Record<string, ChatMessage[]> = { old: [msg('old', 1)], new: Array.from({ length: 80 }, (_, i) => msg('new', i + 1)) }
    const c = cacheOf(rooms, (id) => messages[id] ?? [])
    expect(c.rooms.map((r) => r.id)).toEqual(['new', 'old'])
    expect(c.messages.new).toHaveLength(50)
    expect(c.messages.new[0].seq).toBe(31)
    const small = cacheOf(rooms, (id) => messages[id] ?? [], JSON.stringify([rooms[1], messages.new.slice(-50)]).length * 2 + 100)
    expect(small.rooms.map((r) => r.id)).toEqual(['new'])
    expect(isChatCacheData(c)).toBe(true)
    expect(isChatCacheData({ rooms: [{}], messages: {} })).toBe(false)
  })
})
