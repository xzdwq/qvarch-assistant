import { computed, ref, shallowRef, watch } from 'vue'
import { CHAT_PAGE, REACTIONS, cleanChatText, mentionable, mentionsIn, mergeMessages, roomWithMessage, sortRooms, type ChatAgent, type ChatMessage, type ChatReply, type ChatRoom } from '@shared/transport/chat'
import { DEFAULT_CHAT, type ChatPrefs } from '@shared/transport/constants'
import { remoteError } from '@shared/remoteError'
import { CHAT_FEED_MARK } from '@nb/blocks/chat/model'
import { openNote } from './mentions'
import { onServerEvents, type ServerEventHandlers } from './serverEvents'
import { historyOf, roomOfLocal, type LocalChat, type LocalPost } from '@shared/transport/localChat'
import { changeLocal, dropLocal, isLocal, loadLocals, localChat, localChats, makeLocal, postToLocal } from './localChatRooms'
import { serverCall, serverOnline, useTransport } from './transport'

/** A message on its way: shown greyed until the server keeps it; a failed one waits for «Повторить». */
export interface Outgoing {
  room: string
  clientId: string
  text: string
  /** The message it answers. */
  reply?: ChatReply
  failed?: string
}
/** «Печатает…» stays this long after the last sign. */
const TYPING_MS = 3000

/** Where the messages on their way are kept over a restart (this profile's window). */
const OUTBOX_KEY = 'qa.chat.outbox'

/**
 * The chats of the main window, one state for every chat block (two blocks of one room show the same): the rooms,
 * each room's loaded messages (pages, newest last), messages on their way, «печатает…». No server — a new chat is kept
 * here (localChatRooms: one's own, with one's agents, its history on this computer) until a person is added — then it
 * is brought to the server whole. Online again — the rooms and the loaded messages fetched anew and the messages on
 * their way sent (the same ids: each kept once).
 */
const transport = useTransport()
export const chatOnline = serverOnline
export const chatMe = computed(() => transport.value.deviceId)
const meInfo = () => ({ id: chatMe.value, name: transport.value.name || 'Вы' })
export const chatRooms = shallowRef<ChatRoom[]>([])
const messages = shallowRef(new Map<string, ChatMessage[]>())
/** Rooms whose oldest message is loaded. */
const complete = ref(new Set<string>())
const outbox = shallowRef<Outgoing[]>(readOutbox())
const typing = shallowRef(new Map<string, { name: string; until: number }>())
/** The rooms shown now (a block on screen, the window in front): their messages are read as they come. */
const watched = new Map<string, number>()
export const chatPrefs = ref<ChatPrefs>(DEFAULT_CHAT)

export const roomOf = (id: string) => chatRooms.value.find((r) => r.id === id)
export const messagesOf = (id: string) => messages.value.get(id) ?? []
export const pendingOf = (id: string) => outbox.value.filter((o) => o.room === id)
export const isComplete = (id: string) => complete.value.has(id)
/** «Анна печатает…», «ИИ · Анна работает…» (none — '' ). */
export function typingIn(id: string): string {
  const t = typing.value.get(id)
  return t && t.until > Date.now() ? t.name : ''
}

const setMessages = (id: string, list: ChatMessage[]) => (messages.value = new Map(messages.value).set(id, list))
const setRoom = (r: ChatRoom) => (chatRooms.value = sortRooms([...chatRooms.value.filter((x) => x.id !== r.id), r]))
/** A room as the server answered it (made, renamed, someone added). */
export const upsertRoom = (r: ChatRoom) => setRoom(r)
/** A local chat shown: its room and all its messages. */
function showLocal(c: LocalChat): void {
  setRoom(roomOfLocal(c, meInfo()))
  setMessages(c.id, c.messages)
  complete.value = new Set(complete.value).add(c.id)
}
/** A chat of one's own kept here (made with no server; its block keeps its title): shown, made here when new. */
export function holdRoom(id: string, title: string): void {
  if (roomOf(id)) return
  void makeLocal(id, title).then((c) => {
    showLocal(c)
    // (messages written to it before it was kept here — they wait no more)
    for (const o of outbox.value) if (o.room === id) void deliver(o)
  })
}
/** The chat is kept on this computer only (not on the server: one's own, a person never added). */
export const isHeld = (id: string) => isLocal(id)
/**
 * A local chat brought to the server (a person is being added): its agents and its whole history (each message by
 * its own id — sent again, kept once), then it is the server's; the copy here taken away.
 */
export async function publishLocal(id: string): Promise<ChatRoom> {
  const c = localChat(id)
  if (!c) return roomOf(id)!
  const r = await serverCall('chat.create', { id, title: c.title, agents: c.agents.map((a) => ({ id: a.id, name: a.name })), history: historyOf(c) })
  await dropLocal(id)
  setRoom(r)
  await loadLatest(id)
  return r
}
/** A local chat renamed. */
export async function renameLocal(id: string, title: string): Promise<void> {
  showLocal(await changeLocal(id, (c) => ({ ...c, title })))
}
/** One's agent put in a local chat / taken out of it. */
export async function setLocalAgents(id: string, fn: (agents: ChatAgent[]) => ChatAgent[]): Promise<void> {
  showLocal(await changeLocal(id, (c) => ({ ...c, agents: fn(c.agents) })))
}

/** Told of every message come into a room (here or from the server): the agents listen. */
const listeners = new Set<(m: ChatMessage) => void>()
export const onRoomMessage = (fn: (m: ChatMessage) => void) => void listeners.add(fn)
/**
 * A message posted into a room as one's agent's (or with an attachment): kept here for a local chat, sent to the
 * server for the others.
 */
export async function postMessage(room: string, p: LocalPost): Promise<ChatMessage> {
  const m = isLocal(room)
    ? await postToLocal(room, meInfo(), p)
    : await serverCall('chat.send', {
        room,
        text: p.text,
        clientId: crypto.randomUUID(),
        ...(p.agent ? { agent: p.agent.id } : {}),
        ...(p.chain ? { chain: p.chain } : {}),
        ...(p.mentions?.length ? { mentions: p.mentions } : {}),
        ...(p.attach ? { attach: p.attach } : {}),
        ...(p.reply ? { reply: p.reply.seq } : {}),
      })
  received(m)
  return m
}
/** One's agent working in a room: told to the room (a local one — shown here). */
export function tellAgentWorking(room: string, agent: { id: string; name: string }): void {
  if (!isLocal(room)) return void serverCall('chat.typing', { room, agent: agent.id }).catch(() => undefined)
  typing.value = new Map(typing.value).set(room, { name: `${agent.name} работает…`, until: Date.now() + TYPING_MS })
}
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

/** The rooms as the server has them, and the chats still held here. */
async function loadRooms(): Promise<void> {
  const rooms = await serverCall('chat.rooms', {})
  chatRooms.value = sortRooms([...rooms, ...chatRooms.value.filter((r) => isHeld(r.id) && !rooms.some((x) => x.id === r.id))])
}
/** The local chats shown (from the start, with or without a server). */
async function showLocals(): Promise<void> {
  await loadLocals()
  for (const c of localChats()) showLocal(c)
}
/**
 * The latest page of a room: what was loaded before it is dropped (what came while offline may leave a gap), what
 * came after it while it was on its way is kept.
 */
async function loadLatest(id: string): Promise<void> {
  const page = await serverCall('chat.history', { room: id, limit: CHAT_PAGE })
  const last = page.at(-1)?.seq ?? 0
  setMessages(id, mergeMessages(page, messagesOf(id).filter((m) => m.seq > last)))
  const s = new Set(complete.value)
  if (page.length < CHAT_PAGE) s.add(id)
  else s.delete(id)
  complete.value = s
}
/** A room's messages loaded once (a block shows it). */
export async function showRoom(id: string): Promise<void> {
  if (!messages.value.has(id) && chatOnline.value && !isHeld(id)) await loadLatest(id)
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
  if (isHeld(id)) await changeLocal(id, (c) => ({ ...c, readSeq: r.lastSeq })).catch(() => undefined)
  else await serverCall('chat.read', { room: id, seq: r.lastSeq }).catch(() => undefined)
}
/** A block shows the room (on screen) / stops showing it. */
export function watchRoom(id: string, on: boolean): void {
  const n = (watched.get(id) ?? 0) + (on ? 1 : -1)
  if (n > 0) watched.set(id, n)
  else watched.delete(id)
  if (on) void markRead(id)
}

/** A message sent — kept here for a local chat; to the server when there is one (else it waits: sent when it is there). */
async function deliver(o: Outgoing): Promise<void> {
  if (!isHeld(o.room) && !chatOnline.value) return
  try {
    const r = roomOf(o.room)
    const mentions = r ? mentionsIn(o.text, mentionable(r)) : []
    const m = isHeld(o.room)
      ? await postToLocal(o.room, meInfo(), { text: o.text, ...(mentions.length ? { mentions } : {}), ...(o.reply ? { reply: o.reply } : {}) })
      : await serverCall('chat.send', { room: o.room, text: o.text, clientId: o.clientId, ...(mentions.length ? { mentions } : {}), ...(o.reply ? { reply: o.reply.seq } : {}) })
    outbox.value = outbox.value.filter((x) => x.clientId !== o.clientId)
    received(m)
  } catch (e) {
    outbox.value = outbox.value.map((x) => (x.clientId === o.clientId ? { ...x, failed: remoteError(e) } : x))
  }
}
/** A message typed sent (empty or too long — not); `reply` — the message it answers. */
export function sendMessage(room: string, text: string, reply?: ChatReply): boolean {
  const body = cleanChatText(text)
  if (body === null) return false
  const o: Outgoing = { room, clientId: crypto.randomUUID(), text: body, ...(reply ? { reply } : {}) }
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
/** When this device last told a room it is typing. */
const typedAt = new Map<string, number>()
/** «Печатает…» told to the room's others — once in a while as one types (they show it a few seconds). */
export function tellTyping(room: string): void {
  const now = Date.now()
  if (!chatOnline.value || isHeld(room) || now - (typedAt.get(room) ?? 0) < TYPING_MS - 500) return
  typedAt.set(room, now)
  void serverCall('chat.typing', { room }).catch(() => undefined)
}
/** The reactions offered first (the ones this person puts most; kept on this computer). */
export const quickReactions = ref<string[]>([...REACTIONS])
let quickAsked = false
export function loadQuickReactions(): void {
  if (quickAsked) return
  quickAsked = true
  void window.qa.chatQuickReactions().then((q) => (quickReactions.value = q), () => (quickAsked = false))
}
/** A reaction of this device's on a message put / taken back (already its — taken back); one put — counted. */
export async function toggleReaction(m: ChatMessage, emoji: string): Promise<void> {
  const mine = !!m.reactions?.[emoji]?.some((d) => d.id === chatMe.value)
  if (!mine) void window.qa.chatReactionPut(emoji).then((q) => (quickReactions.value = q), () => undefined)
  if (!isHeld(m.room)) return edited(await serverCall('chat.react', { room: m.room, seq: m.seq, emoji, on: !mine }))
  // a local chat: one's own reactions kept here
  const reactions = { ...m.reactions, [emoji]: mine ? [] : [meInfo()] }
  const next = { ...m, reactions }
  await changeLocal(m.room, (c) => ({ ...c, messages: mergeMessages(c.messages, [next]) }))
  edited(next)
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
  if ((m.author.id !== chatMe.value || m.agent) && typing.value.has(m.room)) {
    const t = new Map(typing.value)
    t.delete(m.room)
    typing.value = t
  }
  void markRead(m.room)
  for (const fn of listeners) fn(m)
}
/** The chat's events of the server. */
const EVENTS: ServerEventHandlers = {
  'chat.message': received,
  'chat.edited': edited,
  'chat.room': setRoom,
  'chat.typing': (p) => {
    const said = p.agent ? `${p.agent.name} работает…` : `${p.device.name} печатает…`
    typing.value = new Map(typing.value).set(p.room, { name: said, until: Date.now() + TYPING_MS })
    setTimeout(() => (typing.value = new Map(typing.value)), TYPING_MS + 50)
  },
  // a shared space gone for this device: its chats go with it
  'space.gone': (p) => (chatRooms.value = chatRooms.value.filter((r) => r.space !== p.space)),
}

/** Online (again): the rooms and the loaded messages fetched anew, the messages on their way sent again. */
async function resync(): Promise<void> {
  try {
    await loadRooms()
    const loaded = [...messages.value.keys()].filter((id) => roomOf(id) && !isHeld(id))
    messages.value = new Map([...messages.value].filter(([id]) => isHeld(id)))
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
  onServerEvents(EVENTS)
  window.qa.onChatOpen((room) => void openChat(room).catch(() => undefined))
  void showLocals().then(() => outbox.value.filter((o) => isHeld(o.room)).forEach((o) => void deliver(o)))
  watch(chatOnline, (on) => on && void resync(), { immediate: true })
  watch(outbox, keepOutbox)
  document.addEventListener('visibilitychange', () => watched.forEach((_n, id) => void markRead(id)))
}

/** The messages on their way as kept (none, or not readable — none). */
function readOutbox(): Outgoing[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((o): o is Outgoing => !!o && typeof o.room === 'string' && typeof o.clientId === 'string' && typeof o.text === 'string') : []
  } catch {
    return []
  }
}
function keepOutbox(list: Outgoing[]): void {
  try {
    if (list.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(list))
    else localStorage.removeItem(OUTBOX_KEY)
  } catch {
    // (kept for this run only)
  }
}
