import { watch, type Ref } from 'vue'
import type { ChatMessage, ChatRoom } from '@shared/transport/chat'
import { cacheOf, type ChatCacheData } from '@shared/transport/chatOffline'

/** The cache written this long after the chats last changed. */
const SAVE_AFTER_MS = 3000

/**
 * The server's chats kept on the computer: shown when the app starts with no server (`show` — before the server's
 * rooms come; they replace them), written again as they change — only what the server gave this run (`fresh`), never
 * the kept copy over itself.
 */
export function startChatCache(o: {
  rooms: Ref<ChatRoom[]>
  messages: Ref<ReadonlyMap<string, ChatMessage[]>>
  kept: (id: string) => boolean
  fresh: () => boolean
  show: (c: ChatCacheData) => void
}): void {
  void window.qa
    .chatCache()
    .then((c) => c && !o.fresh() && o.show(c))
    .catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch([o.rooms, o.messages], () => {
    if (!o.fresh()) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const rooms = o.rooms.value.filter((r) => o.kept(r.id))
      void window.qa.chatCacheSave(cacheOf(rooms, (id) => o.messages.value.get(id) ?? [])).catch(() => undefined)
    }, SAVE_AFTER_MS)
  })
}
