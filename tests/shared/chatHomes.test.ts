import { describe, expect, it } from 'vitest'
import { isHomeless, type ChatRoom } from '../../src/shared/transport/chat'
import { chatRoomsIn } from '../../src/notebook/blocks/chat/model'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const room = (id: string, extra: Partial<ChatRoom> = {}): ChatRoom => ({ id, title: id, members: [], lastSeq: 0, readSeq: 0, ...extra })

describe('chats in none of one’s notes', () => {
  it('a note’s chat blocks give their rooms (each once; a «room:» line outside a chat block — not)', () => {
    const text = ['# Т', '```chat', `room: ${A}`, '```', 'текст', `room: ${B}`, '```chat', `room: ${A.toUpperCase()}`, 'rows: 10', '```'].join('\n')
    expect(chatRoomsIn(text)).toEqual([A])
  })
  it('in no note — homeless; a branch lives where its main one does; a shared note’s chat and a comment never', () => {
    const homes = new Set([A])
    expect(isHomeless(room(A), homes)).toBe(false)
    expect(isHomeless(room(B), homes)).toBe(true)
    expect(isHomeless(room(B, { parent: A }), homes)).toBe(false)
    expect(isHomeless(room(B, { space: 's' }), homes)).toBe(false)
    expect(isHomeless(room(B, { doc: 'd' }), homes)).toBe(false)
  })
})
