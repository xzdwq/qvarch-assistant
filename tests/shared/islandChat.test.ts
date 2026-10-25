import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatRoom } from '../../src/shared/transport/chat'
import { islandChatOf, islandMessageOf, roomToShow, stepRoom } from '../../src/shared/islandChat'

const me = { id: 'me', name: 'Я' }
const other = { id: 'o', name: 'Коллега' }
const msg = (room: string, seq: number, at: number, author = other, text = `m${seq}`): ChatMessage => ({ room, seq, id: `${room}${seq}`, author, text, at })
const room = (id: string, lastSeq: number, readSeq: number, at: number): ChatRoom => ({ id, title: id, members: [me, other], lastSeq, readSeq, createdBy: 'me', last: msg(id, lastSeq, at) })

describe('the chats in the island', () => {
  const state = islandChatOf([room('a', 5, 5, 100), room('b', 3, 1, 50), room('c', 9, 9, 300)])
  it('the rooms by their last activity; unread counted in all', () => {
    expect(state.rooms.map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(state.unread).toBe(2)
  })
  it('opens on the room chosen; the feed — the latest with unread, else the latest', () => {
    expect(roomToShow(state, 'a')).toBe('a')
    expect(roomToShow(state, '')).toBe('b')
    expect(roomToShow(state, 'gone')).toBe('b')
    expect(roomToShow(islandChatOf([room('a', 5, 5, 100), room('c', 9, 9, 300)]), '')).toBe('c')
    expect(roomToShow(islandChatOf([]), '')).toBeUndefined()
  })
  it('the rooms browsed round', () => {
    expect(stepRoom(state, 'b', 1)).toBe('c')
    expect(stepRoom(state, 'c', -1)).toBe('b')
    expect(stepRoom(state, undefined, 1)).toBe('c')
  })
  it('one’s own message — mine; one’s agent’s — not; a file — its word', () => {
    expect(islandMessageOf(msg('a', 1, 1, me), 'me').mine).toBe(true)
    expect(islandMessageOf({ ...msg('a', 1, 1, me), agent: { id: 'me:p', name: 'ИИ' } }, 'me')).toMatchObject({ mine: false, author: 'ИИ' })
    expect(islandMessageOf({ ...msg('a', 2, 1, me, ''), attach: { kind: 'voice', title: 'Голосовое 0:05', data: {} } }, 'me').text).toBe('🎤 Голосовое 0:05')
  })
})
