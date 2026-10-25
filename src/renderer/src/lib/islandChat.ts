import { watch } from 'vue'
import { ISLAND_MESSAGES, islandChatOf, islandMessageOf, type IslandChatOps } from '@shared/islandChat'
import { replyOf } from '@shared/transport/chat'
import { chatMe, chatRooms, markRead, messagesOf, openChat, sendMessage, showRoom } from './chat'

/**
 * The chats for the island (it runs apart; the chats live here): their short state told whenever it changes, the
 * island's asks done — a room's latest messages (read: the island shows them), a message sent, a room opened.
 */
const OPS: { [K in keyof IslandChatOps]: (a: Parameters<IslandChatOps[K]>[0]) => Promise<ReturnType<IslandChatOps[K]>> } = {
  async messages({ room }) {
    await showRoom(room)
    void markRead(room).catch(() => undefined)
    return messagesOf(room)
      .slice(-ISLAND_MESSAGES)
      .map((m) => islandMessageOf(m, chatMe.value))
  },
  async send({ room, text, reply }) {
    const answered = reply === undefined ? undefined : messagesOf(room).find((m) => m.seq === reply)
    if (!sendMessage(room, text, answered && replyOf(answered))) throw new Error('Пустое или слишком длинное сообщение')
    return true
  },
  async open({ room }) {
    await openChat(room)
    return true
  },
}

let on = false
export function startIslandChat(): void {
  if (on) return
  on = true
  // (a burst of events — told once, a moment after)
  let timer: ReturnType<typeof setTimeout> | undefined
  let told = ''
  watch(
    chatRooms,
    (rooms) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const s = islandChatOf(rooms)
        const json = JSON.stringify(s)
        if (json === told) return
        told = json
        window.qa.islandChatPublish(s)
      }, 200)
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
