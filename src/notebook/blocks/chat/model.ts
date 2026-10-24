import { fenceBodyLines } from '../../domain/fence'

/**
 * A chat in a note: ```chat / room: <the room's id on the server> ```. The link is the room's id — the note may be
 * renamed or moved, the text around it edited, the block copied elsewhere: it is the same chat.
 */
export const chatMd = (room: string) => `\`\`\`chat\nroom: ${room}\n\`\`\``
/** The feed of every chat and discussion (```chatfeed) — put wherever one wants it, as many as one wants. */
export const chatFeedMd = () => '```chatfeed\n```'
/** The text a note with a feed has (a notification's chat is opened in one). */
export const CHAT_FEED_MARK = '```chatfeed'

/** A field of a block's body (`key: value` on a line of its own; '' — none). */
function fieldOf(src: string, key: string): string {
  const re = new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`, 'i')
  for (const l of fenceBodyLines(src)) {
    const m = re.exec(l)
    if (m) return m[1]
  }
  return ''
}
/** A block's text with a field set (its line replaced, or added at the end of the body). */
function withField(src: string, key: string, value: string): string {
  const lines = src.split('\n')
  const re = new RegExp(`^(\\s*${key}\\s*:\\s*).*$`, 'i')
  const at = lines.findIndex((l, i) => i > 0 && i < lines.length - 1 && re.test(l))
  if (at >= 0) lines[at] = lines[at].replace(re, `$1${value}`)
  else lines.splice(Math.max(1, lines.length - 1), 0, `${key}: ${value}`)
  return lines.join('\n')
}

/** The room's id of a block ('' — none). */
export function chatRoomOf(src: string): string {
  const id = fieldOf(src, 'room')
  return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : ''
}
/** A block's text with another room (the chat it shows went on as another conversation). */
export const withChatRoom = (src: string, room: string) => withField(src, 'room', room)

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
