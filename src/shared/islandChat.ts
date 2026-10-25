import { attachWord, authorName, sortRooms, unreadOf, type ChatMessage, type ChatReply, type ChatRoom } from './transport/chat'

/**
 * The chats as the island shows them: the main window holds the chats (the server's and the local ones) and tells the
 * island their short state — the rooms by their last activity, each one's unread count, its last message; the island
 * asks it for a room's latest messages and sends through it.
 */
export interface IslandRoom {
  id: string
  title: string
  unread: number
  lastSeq: number
  last?: { author: string; text: string; at: number }
}
export interface IslandChatState {
  /** Unread in all the rooms (shown always — notifications on or off). */
  unread: number
  rooms: IslandRoom[]
}
export const NO_ISLAND_CHAT: IslandChatState = { unread: 0, rooms: [] }
/** A message as the island draws it. */
export interface IslandMessage {
  seq: number
  author: string
  text: string
  at: number
  mine: boolean
  reply?: ChatReply
}
/** What the island asks the main window to do with the chats. */
export interface IslandChatOps {
  /** A room's latest messages (read: shown). */
  messages: (a: { room: string }) => IslandMessage[]
  send: (a: { room: string; text: string; reply?: number }) => true
  /** The room opened in the app (its note, else the feed). */
  open: (a: { room: string }) => true
}
export type IslandChatOp = keyof IslandChatOps
export const ISLAND_CHAT_OPS = ['messages', 'send', 'open'] as const satisfies readonly IslandChatOp[]
/** The latest messages the island shows of a room. */
export const ISLAND_MESSAGES = 40

/** What the orb opens: the quick note or the chats. */
export const ORB_MODES = ['note', 'chat'] as const
export type OrbMode = (typeof ORB_MODES)[number]

/** A message's line in a list: its words, or its attachment's word. */
const lineOf = (m: ChatMessage) => m.text.trim() || (m.attach ? attachWord(m.attach) : '')

/** The rooms' short state (the latest active first). */
export function islandChatOf(rooms: readonly ChatRoom[]): IslandChatState {
  const list = sortRooms(rooms).map(
    (r): IslandRoom => ({ id: r.id, title: r.title, unread: unreadOf(r), lastSeq: r.lastSeq, ...(r.last ? { last: { author: authorName(r.last), text: lineOf(r.last), at: r.last.at } } : {}) }),
  )
  return { unread: list.reduce((n, r) => n + r.unread, 0), rooms: list }
}
/** A message as the island draws it. */
export const islandMessageOf = (m: ChatMessage, me: string): IslandMessage => ({ seq: m.seq, author: authorName(m), text: lineOf(m), at: m.at, mine: m.author.id === me && !m.agent, ...(m.reply ? { reply: m.reply } : {}) })

/**
 * The room the island opens on: the one chosen (`pick` — its id), else (the feed: `pick` empty or gone) the latest one
 * with unread messages, else the latest active; none — no rooms.
 */
export function roomToShow(s: IslandChatState, pick: string | undefined): string | undefined {
  if (pick && s.rooms.some((r) => r.id === pick)) return pick
  return (s.rooms.find((r) => r.unread > 0) ?? s.rooms[0])?.id
}
/** The room before / after this one in the list (round). */
export function stepRoom(s: IslandChatState, room: string | undefined, dir: 1 | -1): string | undefined {
  const n = s.rooms.length
  if (!n) return undefined
  const at = s.rooms.findIndex((r) => r.id === room)
  return s.rooms[at < 0 ? 0 : (at + dir + n) % n].id
}
