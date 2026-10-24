import { mentionsIn, type ChatAttach, type ChatRoom } from '@shared/transport/chat'
import type { DeviceInfo } from '@shared/transport/protocol'
import { chatPrefs, received, roomOf, upsertRoom } from './chat'
import { serverCall } from './transport'

/**
 * What one does with chats besides writing: a chat of one's own made, renamed (by its maker), people added (the
 * main conversation with them goes on, or this one becomes its branch), a chat told or silenced, a block's result sent.
 */

/** A new chat of one's own (no one else in it yet). */
export async function createChat(title?: string): Promise<ChatRoom> {
  const r = await serverCall('chat.create', title ? { title } : {})
  upsertRoom(r)
  return r
}
export async function renameChat(room: string, title: string): Promise<void> {
  upsertRoom(await serverCall('chat.rename', { room, title }))
}
/** The people one may add: those one shares a chat or a shared note with. */
export const chatPeople = (): Promise<DeviceInfo[]> => serverCall('chat.people', {})
/** The main conversation with one person (none — never talked). */
export const mainWith = (device: string): Promise<ChatRoom | null> => serverCall('chat.main', { device })
/** A person added: this chat a branch of the main conversation with them — or the main one goes on (returned then). */
export async function addPerson(room: string, device: string, as: 'branch' | 'main'): Promise<ChatRoom> {
  const r = await serverCall('chat.add', { room, device, as })
  upsertRoom(r)
  return r
}

/** A chat's notifications: on, off, or as all chats (undefined). */
export async function setChatNotify(room: string, on: boolean | undefined): Promise<void> {
  const rooms = { ...chatPrefs.value.rooms }
  if (on === undefined) delete rooms[room]
  else rooms[room] = on
  const s = await window.qa.updateSettings({ chat: { rooms } })
  chatPrefs.value = s.chat
}

/** An attachment sent into a chat — a block's result, a file (with words, or none; the members they mention told). */
export async function sendAttach(room: string, attach: ChatAttach, text = ''): Promise<void> {
  const mentions = mentionsIn(text, roomOf(room)?.members ?? [])
  received(await serverCall('chat.send', { room, text, clientId: crypto.randomUUID(), attach: JSON.parse(JSON.stringify(attach)) as ChatAttach, ...(mentions.length ? { mentions } : {}) }))
}
