import { isFileKind, mentionable, mentionsIn, type ChatAttach, type ChatReply, type ChatRoom } from '@shared/transport/chat'
import type { DeviceInfo } from '@shared/transport/protocol'
import { chatOnline, chatPrefs, holdRoom, isHeld, postMessage, publishLocal, renameLocal, roomOf, upsertRoom } from './chat'
import { serverCall } from './transport'

/**
 * What one does with chats besides writing: a chat of one's own made, renamed (by its maker), people added (the
 * main conversation with them goes on, or this one becomes its branch), a chat told or silenced, a block's result sent.
 */

/**
 * A new chat of one's own (no one else in it yet), by its own id: made on the server now — or, with no server, held
 * here (`held` — its block keeps the title then) and made once the server is there.
 */
export async function newChat(title: string): Promise<{ id: string; held: boolean }> {
  const id = crypto.randomUUID()
  if (!chatOnline.value) {
    holdRoom(id, title)
    return { id, held: true }
  }
  upsertRoom(await serverCall('chat.create', { id, title }))
  return { id, held: false }
}
export async function renameChat(room: string, title: string): Promise<void> {
  if (isHeld(room)) return renameLocal(room, title)
  upsertRoom(await serverCall('chat.rename', { room, title }))
}
/** The people one may add: those one shares a chat or a shared note with. */
export const chatPeople = (): Promise<DeviceInfo[]> => serverCall('chat.people', {})
/** The main conversation with one person (none — never talked). */
export const mainWith = (device: string): Promise<ChatRoom | null> => serverCall('chat.main', { device })
/** A person added: this chat a branch of the main conversation with them — or the main one goes on (returned then). */
export async function addPerson(room: string, device: string, as: 'branch' | 'main'): Promise<ChatRoom> {
  // a chat kept here: brought to the server whole first (its history, its agents)
  if (isHeld(room)) await publishLocal(room)
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
export async function sendAttach(room: string, attach: ChatAttach, text = '', reply?: ChatReply): Promise<void> {
  const r = roomOf(room)
  const mentions = r ? mentionsIn(text, mentionable(r)) : []
  if (isHeld(room) && isFileKind(attach.kind)) throw new Error('Файлы отправляются через сервер — этот чат пока только на этом компьютере')
  await postMessage(room, { text, attach: JSON.parse(JSON.stringify(attach)) as ChatAttach, ...(mentions.length ? { mentions } : {}), ...(reply ? { reply } : {}) })
}
