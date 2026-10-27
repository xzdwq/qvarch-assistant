import { computed, ref, watch } from 'vue'
import { islandChatOf, type IslandChatOps, type IslandChatState } from '@shared/islandChat'
import { mayWriteIn } from '@nb/blocks/chat/roomRights'
import { chatPortLocal } from './chatPortLocal'
import { homeless } from '@nb/workspace/treeFacts'
import { loadTree, tree } from '@nb/workspace/vaultTreeStore'
import { chatMe, chatOnline, chatPrefs, chatRooms, deleteChat, messagesOf, openChat, pendingOf, showInIsland } from './chat'

/**
 * The chats for the island (it runs apart; the chats live here): their state told whenever it changes — the rooms in
 * short and the room the island shows, whole; the island's asks done here, with this window's chats (chatPortLocal:
 * the same as a note's chat does them — the agents answer here, knowing their document).
 */
const port = chatPortLocal
/** The room the island shows ('' — none). */
const shownRoom = ref('')

/** One's message on its way, by its id (the island's room first). */
const outgoing = (clientId: string) => [shownRoom.value, ...chatRooms.value.map((r) => r.id)].flatMap((id) => pendingOf(id)).find((o) => o.clientId === clientId)
const messageOf = (room: string, seq: number) => messagesOf(room).find((m) => m.seq === seq)

const OPS: { [K in keyof IslandChatOps]: (a: Parameters<IslandChatOps[K]>[0]) => Promise<ReturnType<IslandChatOps[K]>> } = {
  async show({ room }) {
    shownRoom.value = room
    showInIsland(room)
    if (room) await port.show(room)
    return true
  },
  async send({ room, text, reply }) {
    if (!port.send(room, text, reply)) throw new Error('Пустое или слишком длинное сообщение')
    return true
  },
  async sendFile({ room, name, type, bytes, text, reply }) {
    await port.sendFile(room, new File([bytes as BlobPart], name, { type }), text, reply)
    return true
  },
  async sendVoice({ room, bytes, sec, text, reply }) {
    await port.sendVoice(room, new Blob([bytes as BlobPart], { type: 'audio/webm' }), sec, reply, text)
    return true
  },
  async sendNotes({ room, rel, withRuns, text }) {
    await port.sendNotes(room, rel, withRuns, text)
    return true
  },
  async retry({ clientId }) {
    const o = outgoing(clientId)
    if (o) port.retry(o)
    return true
  },
  async discard({ clientId }) {
    const o = outgoing(clientId)
    if (o) port.discard(o)
    return true
  },
  async typing({ room }) {
    port.tellTyping(room)
    return true
  },
  async react({ room, seq, emoji }) {
    const m = messageOf(room, seq)
    if (m) await port.react(m, emoji)
    return true
  },
  async loadOlder({ room }) {
    await port.loadOlder(room)
    return true
  },
  async stopAgent({ room }) {
    port.stopAgent(room)
    return true
  },
  async follow({ link }) {
    await port.follow(link)
    return true
  },
  takeNotes: ({ room, file }) => port.takeNotes(room, file),
  async open({ room }) {
    await openChat(room)
    return true
  },
  async remove({ room }) {
    await deleteChat(room)
    return true
  },
}

/** The state the island gets: the rooms, the room it shows whole. */
const state = computed((): IslandChatState => {
  const id = shownRoom.value
  const room = id ? port.roomOf(id) : undefined
  const working = room && port.workingIn(id)
  return {
    ...islandChatOf(chatRooms.value, homeless),
    me: chatMe.value,
    online: chatOnline.value,
    prefs: chatPrefs.value,
    ...(room
      ? { shown: { room, messages: port.messagesOf(id), pending: port.pendingOf(id), complete: port.isComplete(id), typing: port.typingIn(id), held: port.isHeld(id), writable: mayWriteIn(room), ...(working ? { working: { name: working.name } } : {}) } }
      : {}),
  }
})

let on = false
export function startIslandChat(): void {
  if (on) return
  on = true
  // the notes' chats known from the start (which rooms are in none of them), the notebook opened or not
  if (!tree.value.length) void loadTree().catch(() => undefined)
  // (a burst of changes — told once, a moment after; the same state — not told again)
  let timer: ReturnType<typeof setTimeout> | undefined
  let told = ''
  watch(
    state,
    (s) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const json = JSON.stringify(s)
        if (json === told) return
        told = json
        window.qa.islandChatPublish(JSON.parse(json) as IslandChatState)
      }, 60)
    },
    { immediate: true },
  )
  window.qa.onIslandChatCall((id, op, args) => {
    const fn = OPS[op] as ((a: Record<string, unknown>) => Promise<unknown>) | undefined
    if (!fn) return window.qa.islandChatReply(id, false, `Неизвестная операция ${op}`)
    fn(args).then(
      (v) => window.qa.islandChatReply(id, true, v),
      (e: unknown) => window.qa.islandChatReply(id, false, e instanceof Error ? e.message : String(e)),
    )
  })
}
