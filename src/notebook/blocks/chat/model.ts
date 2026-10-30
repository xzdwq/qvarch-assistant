import { bodyField, withBodyField } from '../../domain/fence'
import { fencedBlocksOf } from '../../domain/noteBlocks'

/**
 * A chat in a note: ```chat / room: <the room's id on the server> ```. The link is the room's id — the note may be
 * renamed or moved, the text around it edited, the block copied elsewhere: it is the same chat.
 */
export const chatMd = (room: string, title?: string) => `\`\`\`chat\nroom: ${room}\n${title ? `title: ${title.replace(/\s+/g, ' ')}\n` : ''}\`\`\``
/** The feed of every chat and discussion (```chatfeed) — put wherever one wants it, as many as one wants. */
export const chatFeedMd = () => '```chatfeed\n```'
/** The text a note with a feed has (a notification's chat is opened in one). */
export const CHAT_FEED_MARK = '```chatfeed'

const fieldOf = bodyField
const withField = withBodyField

/** The room's id of a block ('' — none). */
export function chatRoomOf(src: string): string {
  const id = fieldOf(src, 'room')
  return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : ''
}
/** The rooms of a note's chat blocks, each once. */
export const chatRoomsIn = (text: string): string[] => [...new Set(fencedBlocksOf(text).flatMap((b) => (b.kind === 'chat' && chatRoomOf(b.src) ? [chatRoomOf(b.src)] : [])))]
/** A block's text with another room (the chat it shows went on as another conversation). */
export const withChatRoom = (src: string, room: string) => withField(src, 'room', room)
/**
 * A chat made with no server keeps its title in its block (`title: …`) until the server has made it — the note
 * itself is what makes it then, after any restart ('' — none: the chat is on the server).
 */
export const heldTitleOf = (src: string) => fieldOf(src, 'title')
/** The block's text without the held title (the server has made the chat). */
export function withoutHeldTitle(src: string): string {
  const lines = src.split('\n')
  return lines.filter((l, i) => i === 0 || i === lines.length - 1 || !/^\s*title\s*:/i.test(l)).join('\n')
}

/** A chat's height in lines (its bottom edge dragged: a line at a time), kept in its block (`rows: …`). */
export const ROW_PX = 20
export const ROWS_MIN = 6
export const ROWS_MAX = 60
/** The heights by default: a chat's messages, a feed. */
export const CHAT_ROWS = 16
export const FEED_ROWS = 28
const clampRows = (n: number) => Math.min(ROWS_MAX, Math.max(ROWS_MIN, Math.round(n)))
/** A block's height in lines (none or wrong — the default). */
export function rowsOf(src: string, fallback: number): number {
  const n = Number(fieldOf(src, 'rows'))
  return Number.isFinite(n) && n > 0 ? clampRows(n) : fallback
}
export const withRows = (src: string, rows: number) => withField(src, 'rows', String(clampRows(rows)))
/** The height after its edge was dragged this far (px; down — taller), a whole line at a time. */
export const rowsAfterDrag = (start: number, dy: number) => clampRows(start + dy / ROW_PX)
