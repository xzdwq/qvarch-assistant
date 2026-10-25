import { mergeMessages, type ChatAgent, type ChatHistoryItem, type ChatMessage, type ChatRoom } from './chat'
import type { DeviceInfo } from './protocol'

/**
 * A chat kept on this computer only: one's own (no one else in it), with one's agents — it needs no server. Its
 * messages numbered here. A person added — it is brought to the server whole (its history, its agents) and goes on
 * there.
 */
export interface LocalChat {
  id: string
  title: string
  agents: ChatAgent[]
  messages: ChatMessage[]
  readSeq: number
}
export const isLocalChat = (x: unknown): x is LocalChat => {
  const c = x as LocalChat
  return !!c && typeof c === 'object' && /^[0-9a-f-]{36}$/i.test(c.id) && typeof c.title === 'string' && Array.isArray(c.agents) && Array.isArray(c.messages) && typeof c.readSeq === 'number'
}
/** The room it is shown as (its owner its only member). */
export function roomOfLocal(c: LocalChat, me: DeviceInfo): ChatRoom {
  const last = c.messages.at(-1)
  return { id: c.id, title: c.title, members: [me], lastSeq: last?.seq ?? 0, readSeq: c.readSeq, createdBy: me.id, ...(last ? { last } : {}), ...(c.agents.length ? { agents: c.agents } : {}) }
}
/** What a message is written as here: the text, by whom (an agent of one's own — `agent`), with what. */
export type LocalPost = Pick<ChatMessage, 'text'> & Partial<Pick<ChatMessage, 'agent' | 'chain' | 'mentions' | 'attach' | 'reply'>>
/** A message added: the next number, now, by this person (or one's agent). */
export function postLocal(c: LocalChat, me: DeviceInfo, p: LocalPost, at: number): { chat: LocalChat; message: ChatMessage } {
  const seq = (c.messages.at(-1)?.seq ?? 0) + 1
  const message: ChatMessage = { room: c.id, seq, id: crypto.randomUUID(), author: me, at, text: p.text, clientId: crypto.randomUUID(), ...(p.agent ? { agent: p.agent } : {}), ...(p.chain ? { chain: p.chain } : {}), ...(p.mentions?.length ? { mentions: p.mentions } : {}), ...(p.attach ? { attach: p.attach } : {}), ...(p.reply ? { reply: p.reply } : {}) }
  return { chat: { ...c, messages: mergeMessages(c.messages, [message]), readSeq: p.agent ? c.readSeq : seq }, message }
}
/** Its messages as the server takes them (files of the room are not here: a local chat has none). */
export const historyOf = (c: LocalChat): ChatHistoryItem[] =>
  c.messages.map((m) => ({ clientId: m.clientId ?? m.id, text: m.text, at: m.at, ...(m.agent ? { agent: m.agent.id } : {}), ...(m.chain ? { chain: m.chain } : {}), ...(m.mentions?.length ? { mentions: m.mentions } : {}), ...(m.attach ? { attach: m.attach } : {}), ...(m.reply ? { reply: m.reply.seq } : {}) }))
