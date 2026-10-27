import { computed, type Ref } from 'vue'
import type { IslandChatOp, IslandChatOps, IslandChatState } from '@shared/islandChat'
import { cleanChatText } from '@shared/transport/chat'
import type { ChatPort } from '@nb/blocks/chat/chatPort'

/** The main window's answer to the island's ask (lib/islandChat.ts). */
export const askChats = <K extends IslandChatOp>(op: K, args: Parameters<IslandChatOps[K]>[0]) => window.qa.islandChatCall(op, args as Record<string, unknown>) as Promise<ReturnType<IslandChatOps[K]>>

/**
 * The island's chats for its chat parts (the same as a note's): the room it shows mirrored from the main window (its
 * messages, one's own on their way, «печатает…», one's agent at work), everything done asked of the main window —
 * where the chats live. A room other than the one shown has nothing here (the island shows one at a time).
 */
export function islandChatPort(state: Readonly<Ref<IslandChatState>>): ChatPort {
  const shown = (id: string) => (state.value.shown?.room.id === id ? state.value.shown : undefined)
  const quiet = (p: Promise<unknown>) => void p.catch(() => undefined)
  const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
  return {
    me: computed(() => state.value.me),
    online: computed(() => state.value.online),
    prefs: computed(() => state.value.prefs),
    roomOf: (id) => shown(id)?.room,
    messagesOf: (id) => shown(id)?.messages ?? [],
    pendingOf: (id) => shown(id)?.pending ?? [],
    isComplete: (id) => shown(id)?.complete ?? false,
    typingIn: (id) => shown(id)?.typing ?? '',
    workingIn: (id) => shown(id)?.working,
    isHeld: (id) => !!shown(id)?.held,
    show: async (id) => void (await askChats('show', { room: id })),
    loadOlder: async (id) => void (await askChats('loadOlder', { room: id })),
    send(room, text, reply) {
      if (cleanChatText(text) === null) return false
      quiet(askChats('send', { room, text, ...(reply ? { reply } : {}) }))
      return true
    },
    sendFile: async (room, f, text, reply) => void (await askChats('sendFile', { room, name: f.name, type: f.type, bytes: await bytesOf(f), text, ...(reply ? { reply } : {}) })),
    sendVoice: async (room, blob, sec, reply, text) => void (await askChats('sendVoice', { room, bytes: await bytesOf(blob), sec, text, ...(reply ? { reply } : {}) })),
    sendNotes: async (room, rel, withRuns, text) => void (await askChats('sendNotes', { room, rel, withRuns, text })),
    retry: (o) => quiet(askChats('retry', { clientId: o.clientId })),
    discard: (o) => quiet(askChats('discard', { clientId: o.clientId })),
    tellTyping: (room) => quiet(askChats('typing', { room })),
    react: async (m, emoji) => void (await askChats('react', { room: m.room, seq: m.seq, emoji })),
    stopAgent: (room) => quiet(askChats('stopAgent', { room })),
    follow: async (link) => void (await askChats('follow', { link })),
    takeNotes: (room, file) => askChats('takeNotes', { room, file }),
  }
}
