import { CHAT_PAGE, type ChatMessage, type ChatReply, type ChatRoom, type Outgoing } from './chat'
import type { DeviceInfo } from './protocol'

/**
 * A server's chat with no server: its rooms and latest messages kept on the computer (shown when the app starts
 * offline), and what is written meanwhile — by the person and by their agents (an agent needs no server) — waiting in
 * line, shown as messages already, sent in order once the server is there.
 */

/** The rooms and their latest messages as kept on the disk. */
export interface ChatCacheData {
  rooms: ChatRoom[]
  messages: Record<string, ChatMessage[]>
}
/** The cache's size at most (the rooms with the latest talk kept first). */
export const CHAT_CACHE_MAX_BYTES = 16 * 1024 * 1024

export const isChatCacheData = (x: unknown): x is ChatCacheData => {
  const c = x as ChatCacheData
  return !!c && typeof c === 'object' && Array.isArray(c.rooms) && !!c.messages && typeof c.messages === 'object' && c.rooms.every((r) => !!r && typeof r.id === 'string' && typeof r.title === 'string')
}
const bytes = (x: unknown) => JSON.stringify(x).length * 2

/** What is kept of the rooms (newest talk first, each with its latest page) — to the size at most. */
export function cacheOf(rooms: readonly ChatRoom[], messagesOf: (id: string) => readonly ChatMessage[], max = CHAT_CACHE_MAX_BYTES): ChatCacheData {
  const out: ChatCacheData = { rooms: [], messages: {} }
  let size = 0
  for (const r of [...rooms].sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0))) {
    const list = messagesOf(r.id).slice(-CHAT_PAGE)
    const n = bytes(r) + bytes(list)
    if (size + n > max) continue
    size += n
    out.rooms.push(r)
    if (list.length) out.messages[r.id] = [...list]
  }
  return out
}

/** Whether a number is a waiting message's (not the server's yet). */
export const isWaitingSeq = (seq: number): boolean => !Number.isInteger(seq)

/**
 * The number the next waiting message of a room gets (`Outgoing.pseq`): after the room's last one and the ones waiting
 * before it — a fraction, never a server's number; an answer to it keeps this number until the server gives the real one.
 */
export function nextWaitingSeq(room: Pick<ChatRoom, 'lastSeq'>, waiting: readonly { pseq?: number }[]): number {
  const top = Math.max(room.lastSeq, ...waiting.map((w) => w.pseq ?? 0))
  const next = Math.round((top + 0.001) * 1000) / 1000
  return Number.isInteger(next) ? next + 0.0005 : next
}

/** A waiting message as the chat shows it and the agents read it. */
export function waitingMessage(o: Outgoing, me: DeviceInfo): ChatMessage {
  return {
    room: o.room,
    seq: o.pseq ?? 0,
    id: o.clientId,
    clientId: o.clientId,
    author: me,
    at: o.at ?? 0,
    text: o.text,
    ...(o.agent ? { agent: o.agent } : {}),
    ...(o.chain ? { chain: o.chain } : {}),
    ...(o.mentions?.length ? { mentions: o.mentions } : {}),
    ...(o.attach ? { attach: o.attach } : {}),
    ...(o.reply ? { reply: o.reply } : {}),
  }
}

/**
 * The number an answer goes to the server with: a server's number as it is; a waiting message's — the number the server
 * gave it when it was sent (not sent yet, or forgotten over a restart — none: the answer goes without its quote).
 */
export function replySeqFor(reply: ChatReply | undefined, sent: ReadonlyMap<number, number>): number | undefined {
  if (!reply) return undefined
  return isWaitingSeq(reply.seq) ? sent.get(reply.seq) : reply.seq
}
