import { describe, expect, it } from 'vitest'
import { CHAT_FEED_MARK, CHAT_ROWS, chatFeedMd, chatMd, chatRoomOf, ROW_PX, ROWS_MAX, ROWS_MIN, rowsAfterDrag, rowsOf, withChatRoom, withRows } from '../../src/notebook/blocks/chat/model'
import { pickerMode } from '../../src/notebook/commands/registry'
import { chatTitleOf, TITLE_MAX } from '../../src/shared/transport/chat'

const ROOM = '0b5f8c1e-2a3d-4e5f-9a8b-7c6d5e4f3a2b'

describe('a chat block', () => {
  it('written and read back by its room', () => {
    expect(chatMd(ROOM)).toBe(`\`\`\`chat\nroom: ${ROOM}\n\`\`\``)
    expect(chatRoomOf(chatMd(ROOM))).toBe(ROOM)
    expect(chatRoomOf('```chat\nroom: не-комната\n```')).toBe('')
    expect(chatRoomOf('```chat\n```')).toBe('')
  })
  it('a block switched to another room (the chat went on as another conversation)', () => {
    const other = '11111111-2222-3333-4444-555555555555'
    expect(chatRoomOf(withChatRoom(chatMd(ROOM), other))).toBe(other)
    expect(chatRoomOf(withChatRoom(withRows(chatMd(ROOM), 20), other))).toBe(other)
  })
  it('the feed: a block of its own, found by its mark', () => {
    expect(chatFeedMd()).toBe('```chatfeed\n```')
    expect(chatFeedMd().startsWith(CHAT_FEED_MARK)).toBe(true)
  })
  it('its height in lines: kept in the block, the room left as it is', () => {
    expect(rowsOf(chatMd(ROOM), CHAT_ROWS)).toBe(CHAT_ROWS)
    const tall = withRows(chatMd(ROOM), 24)
    expect(tall).toBe(`\`\`\`chat\nroom: ${ROOM}\nrows: 24\n\`\`\``)
    expect(rowsOf(tall, CHAT_ROWS)).toBe(24)
    expect(chatRoomOf(tall)).toBe(ROOM)
    // set again — the same line, not a second one
    expect(withRows(tall, 10)).toBe(`\`\`\`chat\nroom: ${ROOM}\nrows: 10\n\`\`\``)
    expect(withRows(chatFeedMd(), 30)).toBe('```chatfeed\nrows: 30\n```')
    expect(rowsOf('```chat\nrows: много\n```', CHAT_ROWS)).toBe(CHAT_ROWS)
    expect(rowsOf('```chat\nrows: 1000\n```', CHAT_ROWS)).toBe(ROWS_MAX)
  })
  it('its bottom edge dragged: a whole line at a time, within the limits', () => {
    expect(rowsAfterDrag(16, ROW_PX * 0.4)).toBe(16)
    expect(rowsAfterDrag(16, ROW_PX * 0.6)).toBe(17)
    expect(rowsAfterDrag(16, -ROW_PX * 3)).toBe(13)
    expect(rowsAfterDrag(16, -ROW_PX * 100)).toBe(ROWS_MIN)
    expect(rowsAfterDrag(16, ROW_PX * 1000)).toBe(ROWS_MAX)
  })
  it('a new chat is named by its note and when it was made', () => {
    const at = new Date(2026, 9, 4, 9, 5)
    expect(chatTitleOf('Заметка', at)).toBe('Заметка · 04.10.2026 09:05')
    expect(chatTitleOf('  ', at)).toBe('Чат · 04.10.2026 09:05')
    const long = chatTitleOf('А'.repeat(500), at)
    expect(long.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(long.endsWith('04.10.2026 09:05')).toBe(true)
  })
  it('«@чат …» — the chats sub-menu', () => {
    expect(pickerMode('чат')).toEqual({ mode: 'chat', q: '' })
    expect(pickerMode('chat тест')).toEqual({ mode: 'chat', q: 'тест' })
    expect(pickerMode('чатик')).toBeUndefined()
  })
})
