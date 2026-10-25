import { shallowRef } from 'vue'
import type { ChatMessage } from '@shared/transport/chat'
import { postLocal, type LocalChat, type LocalPost } from '@shared/transport/localChat'
import type { DeviceInfo } from '@shared/transport/protocol'

/**
 * The chats kept on this computer only, as the window has them (read from main once, each change written back): made
 * with no server, one's own with one's agents; a person added — brought to the server (lib/chat).
 */
const locals = shallowRef(new Map<string, LocalChat>())
let loaded: Promise<void> | undefined
export function loadLocals(): Promise<void> {
  loaded ??= window.qa.localChats().then((list) => void (locals.value = new Map(list.map((c) => [c.id, c]))))
  return loaded
}
export const localChats = () => [...locals.value.values()]
export const localChat = (id: string) => locals.value.get(id)
export const isLocal = (id: string) => locals.value.has(id)

async function keep(c: LocalChat): Promise<LocalChat> {
  locals.value = new Map(locals.value).set(c.id, c)
  await window.qa.localChatSave(JSON.parse(JSON.stringify(c)) as LocalChat)
  return c
}
/** A local chat made (one already here — that one). */
export async function makeLocal(id: string, title: string): Promise<LocalChat> {
  await loadLocals()
  return localChat(id) ?? keep({ id, title, agents: [], messages: [], readSeq: 0 })
}
/** A local chat changed and kept. */
export async function changeLocal(id: string, fn: (c: LocalChat) => LocalChat): Promise<LocalChat> {
  const c = localChat(id)
  if (!c) throw new Error('Чата нет')
  return keep(fn(c))
}
/** A message written into a local chat (by this person, or by one's agent). */
export async function postToLocal(id: string, me: DeviceInfo, p: LocalPost): Promise<ChatMessage> {
  const c = localChat(id)
  if (!c) throw new Error('Чата нет')
  const { chat, message } = postLocal(c, me, p, Date.now())
  await keep(chat)
  return message
}
/** A local chat taken away (it went to the server). */
export async function dropLocal(id: string): Promise<void> {
  const m = new Map(locals.value)
  m.delete(id)
  locals.value = m
  await window.qa.localChatDrop(id)
}
