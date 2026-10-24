import { computed, ref, shallowRef, watch } from 'vue'
import { CHAT_PAGE, cleanChatText, mentionsIn, mergeMessages, roomWithMessage, sortRooms, type ChatMessage, type ChatRoom } from '@shared/transport/chat'
import { DEFAULT_CHAT, type ChatPrefs } from '@shared/transport/constants'
import type { TransportEvent } from '@shared/transport/protocol'
import { remoteError } from '@shared/remoteError'
import { CHAT_FEED_MARK } from '@nb/blocks/chat/model'
import { openNote } from './mentions'
import { serverCall, useTransport } from './transport'

/** A message on its way: shown greyed until the server keeps it; a failed one waits for «Повторить». */
export interface Outgoing {
  room: string
  clientId: string
  text: string
  failed?: string
}
/** «Печатает…» stays this long after the last sign. */
const TYPING_MS = 3000

/**
 * The chats of the main window, one state for every chat block (two blocks of one room show the same): the rooms,
 * each room's loaded messages (pages, newest last), messages on their way, «печатает…». Online again — the rooms and
 * the loaded messages are fetched anew and the messages on their way sent again (the same id: kept once).
 */
const transport = useTransport()
export const chatOnline = computed(() => transport.value.status === 'online')
export const chatMe = computed(() => transport.value.deviceId)
export const chatRooms = shallowRef<ChatRoom[]>([])
const messages = shallowRef(new Map<string, ChatMessage[]>())
/** Rooms whose oldest message is loaded. */
const complete = ref(new Set<string>())
const outbox = shallowRef<Outgoing[]>([])
const typing = shallowRef(new Map<string, { name: string; until: number }>())
/** The rooms shown now (a block on screen, the window in front): their messages are read as they come. */
const watched = new Map<string, number>()
export const chatPrefs = ref<ChatPrefs>(DEFAULT_CHAT)

export const roomOf = (id: string) => chatRooms.value.find((r) => r.id === id)
export const messagesOf = (id: string) => messages.value.get(id) ?? []
export const pendingOf = (id: string) => outbox.value.filter((o) => o.room === id)
export const isComplete = (id: string) => complete.value.has(id)
export function typingIn(id: string): string {
  const t = typing.value.get(id)
  return t && t.until > Date.now() ? t.name : ''
}

const setMessages = (id: string, list: ChatMessage[]) => (messages.value = new Map(messages.value).set(id, list))
const setRoom = (r: ChatRoom) => (chatRooms.value = sortRooms([...chatRooms.value.filter((x) => x.id !== r.id), r]))
/** A room as the server answered it (made, renamed, someone added). */
export const upsertRoom = (r: ChatRoom) => setRoom(r)
/** The branches of a main conversation (its people's other chats). */
export const branchesOf = (main: string) => chatRooms.value.filter((r) => r.parent === main)

/** The room the feeds show (a notification's click picks it). */
export const feedRoom = ref('')
/** A chat opened (a notification's click): the note with its block, else a note with a feed of the chats (it picked there). */
export async function openChat(room: string): Promise<void> {
  feedRoom.value = room
  const own = await window.qa.vaultNotesWith(`room: ${room}`)
  const path = own[0] ?? (await window.qa.vaultNotesWith(CHAT_FEED_MARK))[0]
  if (path) await openNote(path)
}

async function loadRooms(): Promise<void> {
  chatRooms.value = sortRooms(await serverCall('chat.rooms', {}))
}
/** The latest page of a room (what was loaded before is dropped: what came while offline may leave a gap). */
async function loadLatest(id: string): Promise<void> {
  const page = await serverCall('chat.history', { room: id, limit: CHAT_PAGE })
  setMessages(id, page)
  const s = new Set(complete.value)
  if (page.length < CHAT_PAGE) s.add(id)
  else s.delete(id)
  complete.value = s
}
/** A room's messages loaded once (a block shows it). */
export async function showRoom(id: string): Promise<void> {
  if (!messages.value.has(id) && chatOnline.value) await loadLatest(id)
}
export async function loadOlder(id: string): Promise<void> {
  const have = messages.value.get(id) ?? []
  if (!have.length || complete.value.has(id)) return
  const page = await serverCall('chat.history', { room: id, before: have[0].seq, limit: CHAT_PAGE })
  setMessages(id, mergeMessages(page, messages.value.get(id) ?? []))
  if (page.length < CHAT_PAGE) complete.value = new Set(complete.value).add(id)
}
/** A room read up to its last message — while it is shown and the window is in front. */
export async function markRead(id: string): Promise<void> {
  const r = roomOf(id)
  if (!r || r.readSeq >= r.lastSeq || document.hidden || !watched.has(id)) return
  setRoom({ ...r, readSeq: r.lastSeq })
  await serverCall('chat.read', { room: id, seq: r.lastSeq }).catch(() => undefined)
}
/** A block shows the room (on screen) / stops showing it. */
export function watchRoom(id: string, on: boolean): void {
  const n = (watched.get(id) ?? 0) + (on ? 1 : -1)
  if (n > 0) watched.set(id, n)
  else watched.delete(id)
  if (on) void markRead(id)
}

async function deliver(o: Outgoing): Promise<void> {
  try {
    const mentions = mentionsIn(o.text, roomOf(o.room)?.members ?? [])
    const m = await serverCall('chat.send', { room: o.room, text: o.text, clientId: o.clientId, ...(mentions.length ? { mentions } : {}) })
    outbox.value = outbox.value.filter((x) => x.clientId !== o.clientId)
    received(m)
  } catch (e) {
    outbox.value = outbox.value.map((x) => (x.clientId === o.clientId ? { ...x, failed: remoteError(e) } : x))
  }
}
/** A message typed sent (empty or too long — not). */
export function sendMessage(room: string, text: string): boolean {
  const body = cleanChatText(text)
  if (body === null) return false
  const o: Outgoing = { room, clientId: crypto.randomUUID(), text: body }
  outbox.value = [...outbox.value, o]
  void deliver(o)
  return true
}
export function retryMessage(o: Outgoing): void {
  outbox.value = outbox.value.map((x) => (x.clientId === o.clientId ? { ...x, failed: undefined } : x))
  void deliver(o)
}
export function discardMessage(o: Outgoing): void {
  outbox.value = outbox.value.filter((x) => x.clientId !== o.clientId)
}
/** A reaction of this device's on a message put / taken back (already its — taken back). */
export async function toggleReaction(m: ChatMessage, emoji: string): Promise<void> {
  const mine = !!m.reactions?.[emoji]?.some((d) => d.id === chatMe.value)
  edited(await serverCall('chat.react', { room: m.room, seq: m.seq, emoji, on: !mine }))
}
/** A message changed (its reactions): shown anew in its room — no unread, no notice. */
function edited(m: ChatMessage): void {
  if (messages.value.has(m.room)) setMessages(m.room, mergeMessages(messages.value.get(m.room)!, [m]))
  const r = roomOf(m.room)
  if (r?.last?.seq === m.seq) setRoom({ ...r, last: m })
}

/** A message come (an event or the answer to a send): into its room, the room's last message. */
export function received(m: ChatMessage): void {
  if (messages.value.has(m.room)) setMessages(m.room, mergeMessages(messages.value.get(m.room)!, [m]))
  const r = roomOf(m.room)
  if (!r) return void loadRooms().catch(() => undefined)
  setRoom(roomWithMessage(r, m, chatMe.value))
  if (m.author.id !== chatMe.value && typing.value.has(m.room)) {
    const t = new Map(typing.value)
    t.delete(m.room)
    typing.value = t
  }
  void markRead(m.room)
}
const EVENTS: { [K in TransportEvent['e']]: (p: Extract<TransportEvent, { e: K }>['p']) => void } = {
  'chat.message': received,
  'chat.edited': edited,
  'chat.room': setRoom,
  'chat.typing': (p) => {
    typing.value = new Map(typing.value).set(p.room, { name: p.device.name, until: Date.now() + TYPING_MS })
    setTimeout(() => (typing.value = new Map(typing.value)), TYPING_MS + 50)
  },
  // a shared space gone for this device: its chats go with it
  'space.gone': (p) => (chatRooms.value = chatRooms.value.filter((r) => r.space !== p.space)),
  // the shared documents' own (workspace/sharedDocs.ts)
  'space.changed': () => undefined,
  'doc.update': () => undefined,
  'doc.presence': () => undefined,
  'doc.results': () => undefined,
  'media.added': () => undefined,
}

/** Online (again): the rooms and the loaded messages fetched anew, the messages on their way sent again. */
async function resync(): Promise<void> {
  try {
    await loadRooms()
    const loaded = [...messages.value.keys()].filter((id) => roomOf(id))
    messages.value = new Map()
    for (const id of loaded) await loadLatest(id)
    for (const id of watched.keys()) void markRead(id)
    for (const o of outbox.value) void deliver(o)
  } catch {
    // the next connection tries again
  }
}

let started = false
/** The window's chat subscriptions (once, from the app's start: a notification may open a chat any time). */
export function startChat(): void {
  if (started) return
  started = true
  void window.qa.getSettings().then((s) => (chatPrefs.value = s.chat))
  window.qa.onSettings((s) => (chatPrefs.value = s.chat))
  window.qa.onServer((ev) => (EVENTS[ev.e] as (p: unknown) => void)(ev.p))
  window.qa.onChatOpen((room) => void openChat(room).catch(() => undefined))
  watch(chatOnline, (on) => on && void resync(), { immediate: true })
  document.addEventListener('visibilitychange', () => watched.forEach((_n, id) => void markRead(id)))
}
