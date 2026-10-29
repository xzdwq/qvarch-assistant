import type { DeviceInfo } from './protocol'
import { isEmoji } from '../emoji'

/** A message of a room: `seq` — its place in the room (the server gives them in a row, from 1). */
export interface ChatMessage {
  room: string
  seq: number
  id: string
  author: DeviceInfo
  text: string
  at: number
  /** The sender's own id of it (a resend after a lost answer is the same message, not a second one). */
  clientId?: string
  /** Its reactions: each emoji — who put it. */
  reactions?: Record<string, DeviceInfo[]>
  /** The members it mentions (`@Имя`), by device. */
  mentions?: string[]
  /** A block's result sent with it (a query's rows, a request's answer…). */
  attach?: ChatAttach
  /** Written by an agent of the author's (its name shown instead of the author's). */
  agent?: { id: string; name: string }
  /** How deep in a chain of agents calling agents it is (a person's message — none). */
  chain?: number
  /** The message it answers, as that one was when answered. */
  reply?: ChatReply
}
/** A message answered, as the answer keeps it: its number, who wrote it, a piece of its text (or its attachment's word). */
export interface ChatReply {
  seq: number
  author: string
  text: string
}
/** A message on its way: shown greyed until the server keeps it; a failed one waits for «Повторить». */
export interface Outgoing {
  room: string
  clientId: string
  text: string
  /** The message it answers. */
  reply?: ChatReply
  failed?: string
}
/** The piece of an answered message kept with the answer, characters. */
export const REPLY_TEXT_MAX = 160
/** A message as an answer to it keeps it. */
export const replyOf = (m: ChatMessage): ChatReply => ({ seq: m.seq, author: authorName(m), text: (m.text.trim() || (m.attach ? attachWord(m.attach) : '')).slice(0, REPLY_TEXT_MAX) })
/** An AI agent of a member, in a chat: called by its name (`@ИИ · Имя`), it answers there. */
export interface ChatAgent {
  /** `<owner's device>:<its profile>` */
  id: string
  name: string
  owner: string
  /** The room's others may call it (its owner decides; off — it answers its owner only). */
  open?: boolean
}
/** Who wrote a message, as shown: the agent, else the person. */
export const authorName = (m: Pick<ChatMessage, 'author' | 'agent'>): string => m.agent?.name ?? m.author.name
/** Who wrote it, as told apart (an agent and its owner are two). */
export const authorKey = (m: Pick<ChatMessage, 'author' | 'agent'>): string => m.agent?.id ?? m.author.id
/** An agent's chain step at most (kept as given). */
export const CHAIN_LIMIT = 10
/** A message of a chat kept on one's computer, brought to the server (its own id — kept once however often it is sent). */
export interface ChatHistoryItem {
  clientId: string
  text: string
  at: number
  /** Written by one of the author's agents (its id among the chat's agents). */
  agent?: string
  chain?: number
  mentions?: string[]
  attach?: ChatAttach
  /** The number of the message it answers (among these, as numbered here). */
  reply?: number
}
/** A chat's history brought at once — this many messages at most. */
export const HISTORY_MAX = 2000

/** The reactions offered first (any emoji may be put — the full list is a click away). */
export const REACTIONS = ['👍', '❤️', '😄', '😮', '🎉', '✅'] as const
/** An emoji as a reaction: one emoji, a flag too (no words, no markup). */
export const isReaction = isEmoji

/** What a message may carry (each drawn its own way): a block's result, a picture shown right there, a file. */
export const ATTACH_KINDS = ['sql', 'http', 'code', 'pw', 'value', 'image', 'file', 'trace', 'voice'] as const
export type AttachKind = (typeof ATTACH_KINDS)[number]
/** The kinds that are files of the room (kept on the server, fetched over HTTP), not data in the message. */
export const FILE_KINDS = ['image', 'file', 'voice'] as const satisfies readonly AttachKind[]
export type FileKind = (typeof FILE_KINDS)[number]
/** An attachment as a message carries it: what it is, a title (the block, the file's name…), its data (secrets taken off). */
export interface ChatAttach {
  kind: AttachKind
  title: string
  data: unknown
}
/** A file of a room, as a message carries it (its bytes — `CHAT_FILES_PATH`). */
export interface ChatFile {
  id: string
  name: string
  size: number
  mime: string
  /** A voice message's length, seconds. */
  sec?: number
}
/** A voice message's length at most, seconds. */
export const VOICE_MAX_SEC = 15 * 60
/** A file's size at most. */
export const CHAT_FILE_MAX = 50 * 1024 * 1024
const NAME_MAX = 255
/** The pictures shown right in the chat (others — files to save; SVG too: a script may hide in it). */
const SHOWN_IMAGES = /^image\/(png|jpeg|gif|webp|bmp)$/
/** How a file goes: a picture shown in the chat, or a file. */
export const fileKindOf = (mime: string): FileKind => (SHOWN_IMAGES.test(mime) ? 'image' : 'file')
export const isFileKind = (k: AttachKind): k is FileKind => (FILE_KINDS as readonly string[]).includes(k)
export const isChatFile = (x: unknown): x is ChatFile => {
  const f = x as ChatFile
  return !!f && typeof f === 'object' && /^[0-9a-f-]{36}$/i.test(f.id) && typeof f.name === 'string' && !!f.name && f.name.length <= NAME_MAX && Number.isInteger(f.size) && f.size >= 0 && f.size <= CHAT_FILE_MAX && typeof f.mime === 'string' && f.mime.length <= 120 && (f.sec === undefined || (Number.isFinite(f.sec) && f.sec >= 0 && f.sec <= VOICE_MAX_SEC))
}
/** A file's name as kept: no folders, no control characters, not too long (none — «файл»). */
export const cleanFileName = (name: string): string =>
  name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, NAME_MAX) || 'файл'
/** An attachment's size at most in a message, bytes (a table is cut to fit before). */
export const ATTACH_MAX = 180 * 1024
/** Its size as sent (UTF-8 bytes: a Cyrillic letter is two). */
export const attachBytes = (a: unknown): number => new TextEncoder().encode(JSON.stringify(a)).length
export const isAttach = (x: unknown): x is ChatAttach =>
  !!x &&
  typeof x === 'object' &&
  (ATTACH_KINDS as readonly unknown[]).includes((x as ChatAttach).kind) &&
  typeof (x as ChatAttach).title === 'string' &&
  (!isFileKind((x as ChatAttach).kind) || isChatFile((x as ChatAttach).data)) &&
  attachBytes(x) <= ATTACH_MAX
/** A message's attachment in a word (a room's last message in a list). */
export const attachWord = (a: ChatAttach): string => {
  switch (a.kind) {
    case 'image':
      return `🖼 ${a.title}`
    case 'file':
      return `📎 ${a.title}`
    case 'voice':
      return `🎤 ${a.title}`
    case 'trace':
      return ''
    default:
      return a.title
  }
}
/** A length in seconds as «m:ss». */
export const clockSec = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The members a text mentions (`@Имя` — a member's name, the longest one that fits), each once. */
export function mentionsIn(text: string, members: readonly DeviceInfo[]): string[] {
  const out = new Set<string>()
  for (const part of mentionParts(text, members)) if (part.who) out.add(part.who.id)
  return [...out]
}
/** A text in parts: plain ones and mentions (`@Имя` of a member) — to show them apart. */
export function mentionParts(text: string, members: readonly DeviceInfo[]): Array<{ text: string; who?: DeviceInfo }> {
  const byLength = [...members].filter((m) => m.name).sort((a, b) => b.name.length - a.name.length)
  const out: Array<{ text: string; who?: DeviceInfo }> = []
  let plain = ''
  for (let i = 0; i < text.length; i++) {
    // a mention starts a word: «@» at the start or after a space / a bracket
    const who = text[i] === '@' && (i === 0 || /[\s(«"']/.test(text[i - 1])) ? byLength.find((m) => text.startsWith(m.name, i + 1) && !/[\p{L}\p{N}_]/u.test(text[i + 1 + m.name.length] ?? '')) : undefined
    if (!who) {
      plain += text[i]
      continue
    }
    if (plain) out.push({ text: plain })
    plain = ''
    out.push({ text: `@${who.name}`, who })
    i += who.name.length
  }
  if (plain) out.push({ text: plain })
  return out
}
/** A room as one of its members sees it. */
export interface ChatRoom {
  id: string
  title: string
  members: DeviceInfo[]
  /** The room's last message number. */
  lastSeq: number
  /** The last message this member has read. */
  readSeq: number
  last?: ChatMessage
  /** The shared space it belongs to (its members are the space's; it lives in the shared note, not in «Чаты»). */
  space?: string
  /** A comment: the shared document it is about, its place there, solved or not (its messages — the discussion). */
  doc?: string
  anchor?: CommentAnchor
  resolved?: boolean
  /** Who made it (only they rename it). */
  createdBy?: string
  /** A branch: the main conversation of the same people it belongs to (the main one shows its branches' messages too). */
  parent?: string
  /** The members' agents in it. */
  agents?: ChatAgent[]
}
/** Whom one is offered to mention: the people, one's own agents, the others' agents their owners let one call. */
export const callable = (r: Pick<ChatRoom, 'members' | 'agents'>, me: string): Array<{ id: string; name: string }> => [...r.members, ...(r.agents ?? []).filter((a) => a.owner === me || a.open)]
/** Who may be mentioned in a room: its people and their agents. */
export const mentionable = (r: Pick<ChatRoom, 'members' | 'agents'>): Array<{ id: string; name: string }> => [...r.members, ...(r.agents ?? [])]
/** The main conversation's title when none was given. */
export const CHAT_TITLE = 'Чат'
export const TITLE_MAX = 120
/** A new chat's title when none is typed: the note it is made in and when (`Заметка · 24.10.2026 19:12`). */
export function chatTitleOf(note: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const when = `${p(at.getDate())}.${p(at.getMonth() + 1)}.${at.getFullYear()} ${p(at.getHours())}:${p(at.getMinutes())}`
  const name = note.trim() || CHAT_TITLE
  return `${name.slice(0, TITLE_MAX - when.length - 3)} · ${when}`
}
/** A comment's place: where in the note (Yjs relative positions) and the text it was about (shown when it is gone). */
export interface CommentAnchor {
  start: string
  end: string
  quote: string
}
/** A room is a comment (about a place of a document), not a chat. */
export const isComment = (r: ChatRoom): r is ChatRoom & { doc: string; anchor: CommentAnchor } => !!r.doc && !!r.anchor
/**
 * A chat in none of one's notes (`homes` — the rooms one's notes show): its note deleted, or one was added to it and
 * never put it in a note. A shared note's chat and a comment live with their note — never so; a branch lives where its
 * main conversation does.
 */
export const isHomeless = (r: ChatRoom, homes: ReadonlySet<string>): boolean => !r.space && !r.doc && !homes.has(r.id) && !(r.parent && homes.has(r.parent))
export const QUOTE_MAX = 300

export const CHAT_TEXT_MAX = 8000
export const CHAT_PAGE = 50

/** A message's text as kept: the ends trimmed, line ends unified; empty or too long — refused (null). */
export function cleanChatText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\r\n?/g, '\n').trim()
  return t && t.length <= CHAT_TEXT_MAX ? t : null
}

/** The room's messages with new ones added: in `seq` order, each once (an echo of one already there replaces it). */
export function mergeMessages(have: readonly ChatMessage[], add: readonly ChatMessage[]): ChatMessage[] {
  const bySeq = new Map(have.map((m) => [m.seq, m]))
  for (const m of add) bySeq.set(m.seq, m)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/** How many messages of others are not read yet. */
export const unreadOf = (room: ChatRoom): number => Math.max(0, room.lastSeq - room.readSeq)

/** A room with a message come in: its last message, its number, read — when the member wrote it. */
export function roomWithMessage(room: ChatRoom, m: ChatMessage, me: string): ChatRoom {
  if (m.seq <= room.lastSeq && room.last && room.last.seq >= m.seq) return room
  const lastSeq = Math.max(room.lastSeq, m.seq)
  return { ...room, lastSeq, last: m, readSeq: m.author.id === me ? Math.max(room.readSeq, m.seq) : room.readSeq }
}

/** Messages of one author in a row this close (and of one branch) are one group: one name over it, one tail under it. */
export const GROUP_MS = 60_000
/** Each message's place in its group: the first (the name over it), the last (the tail under it). */
export function groupMessages(list: readonly ChatMessage[]): Array<{ first: boolean; last: boolean }> {
  const together = (a?: ChatMessage, b?: ChatMessage) => !!a && !!b && authorKey(a) === authorKey(b) && a.room === b.room && Math.abs(b.at - a.at) < GROUP_MS
  return list.map((m, i) => ({ first: !together(list[i - 1], m), last: !together(m, list[i + 1]) }))
}
/** Messages of several rooms (a conversation and its branches) as one feed, by time. */
export const mergeRooms = (lists: ReadonlyArray<readonly ChatMessage[]>): ChatMessage[] => lists.flat().sort((a, b) => a.at - b.at || a.seq - b.seq)

/** The feed's parts: conversations (each with its branches), the shared notes' chats, the comments — newest first. */
export interface FeedSections {
  talks: Array<{ room: ChatRoom; branches: ChatRoom[] }>
  shared: ChatRoom[]
  comments: ChatRoom[]
}
const lastAt = (r: ChatRoom) => r.last?.at ?? 0
/** The rooms laid out for the feed (a branch whose main one is not here — a conversation of its own). */
export function feedSections(rooms: readonly ChatRoom[]): FeedSections {
  const ids = new Set(rooms.map((r) => r.id))
  const isTalk = (r: ChatRoom) => !r.space && !isComment(r)
  const branches = (id: string) => sortRooms(rooms.filter((r) => isTalk(r) && r.parent === id))
  const talks = rooms
    .filter((r) => isTalk(r) && (!r.parent || !ids.has(r.parent)))
    .map((room) => ({ room, branches: branches(room.id) }))
    .sort((a, b) => Math.max(lastAt(b.room), ...b.branches.map(lastAt)) - Math.max(lastAt(a.room), ...a.branches.map(lastAt)))
  return { talks, shared: sortRooms(rooms.filter((r) => !!r.space && !isComment(r))), comments: sortRooms(rooms.filter(isComment)) }
}

/** Rooms newest first (by their last message; a room without any — by nothing, at the end). */
export const sortRooms = (rooms: readonly ChatRoom[]): ChatRoom[] => [...rooms].sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0))
