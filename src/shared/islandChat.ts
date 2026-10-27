import type { NoteLinkRef } from './notebook/links'
import { attachWord, authorName, sortRooms, unreadOf, type ChatFile, type ChatMessage, type ChatReply, type ChatRoom, type Outgoing } from './transport/chat'
import { DEFAULT_CHAT, type ChatPrefs } from './transport/constants'

/**
 * The chats in the island. The main window holds the chats (the server's and the local ones, the agents, the
 * notebook) and tells the island their state: the rooms by their last activity with their unread counts, and the room
 * the island shows — whole (its messages, one's own on their way, «печатает…», one's agent at work), so the island
 * draws it with the same chat parts as a note. What the island does goes back to the main window as an ask
 * (IslandChatOps): a message, a file, a voice, a reaction — the agents answer there, knowing their document.
 */
export interface IslandRoom {
  id: string
  title: string
  unread: number
  lastSeq: number
  last?: { author: string; text: string; at: number }
  /** In none of one's notes (its note deleted): it may be deleted. */
  homeless?: boolean
}
/** The rooms in short. */
export interface IslandRooms {
  /** Unread in all the rooms (shown always — notifications on or off). */
  unread: number
  rooms: IslandRoom[]
}
/** The room the island shows, whole. */
export interface IslandShown {
  room: ChatRoom
  messages: ChatMessage[]
  pending: Outgoing[]
  complete: boolean
  typing: string
  working?: { name: string }
  /** Kept on this computer only (no server yet: no voice, no typing told). */
  held: boolean
  /** One may write in it (a reader of a shared note — not). */
  writable: boolean
}
export interface IslandChatState extends IslandRooms {
  me: string
  online: boolean
  prefs: ChatPrefs
  /** The room the island shows (none — it shows none). */
  shown?: IslandShown
}
export const NO_ISLAND_CHAT: IslandChatState = { unread: 0, rooms: [], me: '', online: false, prefs: DEFAULT_CHAT }

/** What the island asks the main window to do with the chats (each answered with its result). */
export interface IslandChatOps {
  /** The room the island shows now ('' — none): mirrored to it, read while shown. */
  show: (a: { room: string }) => true
  send: (a: { room: string; text: string; reply?: ChatReply }) => boolean
  sendFile: (a: { room: string; name: string; type: string; bytes: Uint8Array; text: string; reply?: ChatReply }) => true
  sendVoice: (a: { room: string; bytes: Uint8Array; sec: number; text: string; reply?: ChatReply }) => true
  sendNotes: (a: { room: string; rel: string; withRuns: boolean; text: string }) => true
  retry: (a: { clientId: string }) => true
  discard: (a: { clientId: string }) => true
  typing: (a: { room: string }) => true
  react: (a: { room: string; seq: number; emoji: string }) => true
  loadOlder: (a: { room: string }) => true
  stopAgent: (a: { room: string }) => true
  /** A link followed in the app (a note opened there). */
  follow: (a: { link: NoteLinkRef }) => true
  /** A received note / folder put into the notebook: what was done, in words. */
  takeNotes: (a: { room: string; file: ChatFile }) => string
  /** The room opened in the app (its note, else the feed; neither — refused, with why). */
  open: (a: { room: string }) => true
  /** A chat in none of one's notes taken away (left; nobody left — gone whole). */
  remove: (a: { room: string }) => true
}
export type IslandChatOp = keyof IslandChatOps
export const ISLAND_CHAT_OPS = ['show', 'send', 'sendFile', 'sendVoice', 'sendNotes', 'retry', 'discard', 'typing', 'react', 'loadOlder', 'stopAgent', 'follow', 'takeNotes', 'open', 'remove'] as const satisfies readonly IslandChatOp[]
/** The asks that bring the app to the front (what they do is shown there). */
export const ISLAND_OPS_SHOWING_APP: ReadonlySet<IslandChatOp> = new Set<IslandChatOp>(['follow', 'takeNotes', 'open'])

/** What the orb opens: the quick note or the chats. */
export const ORB_MODES = ['note', 'chat'] as const
export type OrbMode = (typeof ORB_MODES)[number]
/** What the unfolded island shows: the day (its timeline and tasks) or the chats. */
export const ISLAND_PANEL_VIEWS = ['day', 'chat'] as const
export type IslandPanelView = (typeof ISLAND_PANEL_VIEWS)[number]

/** A message's line in a list: its words, or its attachment's word. */
const lineOf = (m: ChatMessage) => m.text.trim() || (m.attach ? attachWord(m.attach) : '')

/** The rooms' short state (the latest active first); `homeless` — a room in none of one's notes. */
export function islandChatOf(rooms: readonly ChatRoom[], homeless: (r: ChatRoom) => boolean = () => false): IslandRooms {
  const list = sortRooms(rooms).map(
    (r): IslandRoom => ({
      id: r.id,
      title: r.title,
      unread: unreadOf(r),
      lastSeq: r.lastSeq,
      ...(r.last ? { last: { author: authorName(r.last), text: lineOf(r.last), at: r.last.at } } : {}),
      ...(homeless(r) ? { homeless: true } : {}),
    }),
  )
  return { unread: list.reduce((n, r) => n + r.unread, 0), rooms: list }
}

/**
 * The room the island opens on: the one chosen (`pick` — its id), else (the feed: `pick` empty or gone) the latest one
 * with unread messages, else the latest active; none — no rooms.
 */
export function roomToShow(s: IslandRooms, pick: string | undefined): string | undefined {
  if (pick && s.rooms.some((r) => r.id === pick)) return pick
  return (s.rooms.find((r) => r.unread > 0) ?? s.rooms[0])?.id
}
/** The room before / after this one in the list (round). */
export function stepRoom(s: IslandRooms, room: string | undefined, dir: 1 | -1): string | undefined {
  const n = s.rooms.length
  if (!n) return undefined
  const at = s.rooms.findIndex((r) => r.id === room)
  return s.rooms[at < 0 ? 0 : (at + dir + n) % n].id
}
