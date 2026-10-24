import { describe, expect, it } from 'vitest'
import { attachWord, CHAT_FILE_MAX, cleanChatText, cleanFileName, CHAT_TEXT_MAX, fileKindOf, isAttach, mentionParts, mentionsIn, mergeMessages, roomWithMessage, sortRooms, unreadOf, type ChatFile, type ChatMessage, type ChatRoom } from '../../src/shared/transport/chat'
import { cleanChat, cleanTransport, notifiesIn, socketUrl } from '../../src/shared/transport/constants'
import { parseClientFrame, parseServerFrame } from '../../src/shared/transport/protocol'

const msg = (seq: number, author = 'a', at = seq * 1000): ChatMessage => ({ room: 'r', seq, id: `m${seq}`, author: { id: author, name: author }, text: `t${seq}`, at })
const room = (over: Partial<ChatRoom> = {}): ChatRoom => ({ id: 'r', title: 'R', members: [], lastSeq: 0, readSeq: 0, ...over })

describe('the server\'s address as typed', () => {
  it('a bare host gets ws:// and the default port; http(s) → ws(s); the path is the protocol\'s', () => {
    expect(socketUrl('10.0.0.5', '/v1')).toBe('ws://10.0.0.5:3000/v1')
    expect(socketUrl('host:4000', '/v1')).toBe('ws://host:4000/v1')
    expect(socketUrl('https://chat.example.com', '/v1')).toBe('wss://chat.example.com/v1')
    expect(socketUrl('ws://host:81/anything', '/v1')).toBe('ws://host:81/v1')
    expect(socketUrl('[::1]:5000', '/v1')).toBe('ws://[::1]:5000/v1')
  })
  it('not an address — none', () => {
    expect(socketUrl('', '/v1')).toBeNull()
    expect(socketUrl('ftp://host', '/v1')).toBeNull()
    expect(socketUrl('http://', '/v1')).toBeNull()
  })
})

describe('the settings as read', () => {
  it('unknown and wrong values dropped to the defaults', () => {
    expect(cleanTransport(undefined)).toEqual({ enabled: false, url: '', name: '' })
    expect(cleanTransport({ enabled: true, url: ' h:1 ', name: 'x'.repeat(99), extra: 1 })).toEqual({ enabled: true, url: 'h:1', name: 'x'.repeat(60) })
    // (notifications are off until one turns them on; the old «notify» saved — no longer counts)
    expect(cleanChat({ sendKey: 'shift', notify: true })).toEqual({ sendKey: 'enter', notifyAll: false, rooms: {} })
    const room = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'
    const p = cleanChat({ sendKey: 'ctrlEnter', notifyAll: true, rooms: { [room]: false, 'не-комната': true } })
    expect(p).toEqual({ sendKey: 'ctrlEnter', notifyAll: true, rooms: { [room]: false } })
    expect([notifiesIn(p, room), notifiesIn(p, 'другая')]).toEqual([false, true])
  })
})

describe('a chat message', () => {
  it('its text trimmed, line ends unified; empty or too long — refused', () => {
    expect(cleanChatText('  a\r\nb  ')).toBe('a\nb')
    expect(cleanChatText('   ')).toBeNull()
    expect(cleanChatText(42)).toBeNull()
    expect(cleanChatText('x'.repeat(CHAT_TEXT_MAX + 1))).toBeNull()
  })
  it('messages merged by number: in order, each once', () => {
    expect(mergeMessages([msg(1), msg(3)], [msg(2), msg(3)]).map((m) => m.seq)).toEqual([1, 2, 3])
  })
  it('a room with a message: its last one and number; read when it is mine; an older one changes nothing', () => {
    const r = room({ lastSeq: 2, readSeq: 1, last: msg(2) })
    expect(roomWithMessage(r, msg(3, 'b'), 'me')).toMatchObject({ lastSeq: 3, readSeq: 1, last: { seq: 3 } })
    expect(roomWithMessage(r, msg(3, 'me'), 'me')).toMatchObject({ lastSeq: 3, readSeq: 3 })
    expect(roomWithMessage(r, msg(1), 'me')).toBe(r)
    expect(unreadOf(room({ lastSeq: 5, readSeq: 2 }))).toBe(3)
  })
  it('rooms newest first, the ones without messages last', () => {
    const rooms = [room({ id: 'a' }), room({ id: 'b', last: msg(1) }), room({ id: 'c', last: msg(5) })]
    expect(sortRooms(rooms).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('mentions', () => {
  const members = [
    { id: 'a', name: 'Альфа' },
    { id: 'ab', name: 'Альфа Бета' },
    { id: 'g', name: 'Гамма' },
  ]
  it('a member\'s name after «@» (the longest that fits), a word\'s start only, each once', () => {
    expect(mentionsIn('@Альфа Бета, посмотри; @Гамма и снова @Гамма', members)).toEqual(['ab', 'g'])
    expect(mentionsIn('почта a@Гамма — не упоминание', members)).toEqual([])
    expect(mentionsIn('@Альфачей нет', members)).toEqual([])
    expect(mentionsIn('(@Альфа)', members)).toEqual(['a'])
  })
  it('the text in parts to show the mentions apart', () => {
    expect(mentionParts('привет, @Гамма!', members)).toEqual([{ text: 'привет, ' }, { text: '@Гамма', who: members[2] }, { text: '!' }])
  })
})

describe('the frames', () => {
  it('read when of a known kind and shape, else not', () => {
    expect(parseClientFrame('{"t":"ping"}')).toEqual({ t: 'ping' })
    expect(parseClientFrame('{"t":"req","id":1,"m":"chat.rooms","p":{}}')).toMatchObject({ m: 'chat.rooms' })
    expect(parseClientFrame('{"t":"req","id":"1","m":"x"}')).toBeNull()
    expect(parseClientFrame('{"t":"auth","v":1}')).toBeNull()
    expect(parseClientFrame('{"t":"toString"}')).toBeNull()
    expect(parseClientFrame('не json')).toBeNull()
    expect(parseServerFrame('{"t":"hello","v":1,"nonce":"n","server":"1"}')).toMatchObject({ nonce: 'n' })
    expect(parseServerFrame('{"t":"ev"}')).toBeNull()
  })
})

describe('a chat\'s files', () => {
  const file: ChatFile = { id: '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b', name: 'отчёт.pdf', size: 1200, mime: 'application/pdf' }
  it('a picture is shown right in the chat, anything else (an SVG too) is a file to save', () => {
    expect(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', ''].map(fileKindOf)).toEqual(['image', 'image', 'image', 'file', 'file', 'file'])
  })
  it('a file\'s name as kept: no folders, no control signs, never empty', () => {
    expect(cleanFileName('C:\\Users\\x\\Отчёт.txt')).toBe('Отчёт.txt')
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('a\u0000b\n.txt')).toBe('ab.txt')
    expect(cleanFileName('   ')).toBe('файл')
    expect(cleanFileName('я'.repeat(400)).length).toBe(255)
  })
  it('a message carries a file only as a proper reference; a block\'s result — as before', () => {
    expect(isAttach({ kind: 'file', title: file.name, data: file })).toBe(true)
    expect(isAttach({ kind: 'image', title: 'x', data: { ...file, id: 'не id' } })).toBe(false)
    expect(isAttach({ kind: 'image', title: 'x', data: { ...file, size: CHAT_FILE_MAX + 1 } })).toBe(false)
    expect(isAttach({ kind: 'file', title: 'x' })).toBe(false)
    expect(isAttach({ kind: 'value', title: 'x', data: { value: 1 } })).toBe(true)
    expect(isAttach({ kind: 'зверь', title: 'x', data: 1 })).toBe(false)
  })
  it('in a word (a chat\'s last message in a list, a notification)', () => {
    expect(attachWord({ kind: 'image', title: 'снимок.png', data: file })).toBe('🖼 снимок.png')
    expect(attachWord({ kind: 'file', title: 'отчёт.pdf', data: file })).toBe('📎 отчёт.pdf')
    expect(attachWord({ kind: 'sql', title: 'SQL · rows', data: {} })).toBe('SQL · rows')
  })
})
