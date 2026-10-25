import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { NO_ISLAND_CHAT, roomToShow, stepRoom, type IslandChatOp, type IslandChatOps, type IslandChatState, type IslandMessage, type OrbMode } from '@shared/islandChat'
import { remoteError } from '@shared/remoteError'
import type { IslandElements } from './islandElements'
import type { IslandSettings } from './useIslandSettings'

/** The main window's answer to the island's ask (islandChat.ts). */
const call = <K extends IslandChatOp>(op: K, args: Parameters<IslandChatOps[K]>[0]) => window.qa.islandChatCall(op, args) as Promise<ReturnType<IslandChatOps[K]>>

/**
 * The chats in the island: their unread count (always shown — notifications on or off), and the chat area the orb
 * (or the count) opens — one room's latest messages and a reply. The room shown stays while the area is open
 * (messages of other rooms never switch it); the rooms may be browsed by hand, the room (or the feed) chosen is kept.
 * Each room keeps its own draft: switching never sends a text to another room.
 */
export function useIslandChat(els: IslandElements, island: IslandSettings, hooks: { closeOthers: () => void }) {
  const state = shallowRef<IslandChatState>(NO_ISLAND_CHAT)
  void window.qa.islandChatGet().then((s) => (state.value = s))
  onBeforeUnmount(window.qa.onIslandChat((s) => (state.value = s)))

  const open = ref(false)
  /** The room shown (kept while open). */
  const room = ref<string>()
  const messages = ref<IslandMessage[]>([])
  /** The rooms' list shown instead of the messages (to choose one, or the feed). */
  const picking = ref(false)
  const text = ref('')
  const reply = ref<IslandMessage>()
  const error = ref('')
  const sending = ref(false)
  const drafts = new Map<string, string>()

  const orb = computed<OrbMode>(() => island.settings.value?.island.orb ?? 'note')
  /** The room chosen ('' — the feed). */
  const chosen = computed(() => island.settings.value?.island.chatRoom ?? '')
  const current = computed(() => state.value.rooms.find((r) => r.id === room.value))
  const unread = computed(() => state.value.unread)

  async function load(): Promise<void> {
    const id = room.value
    if (!id) return void (messages.value = [])
    try {
      const list = await call('messages', { room: id })
      if (room.value === id) messages.value = list
      error.value = ''
    } catch (e) {
      error.value = remoteError(e)
    }
  }
  // the room shown got a message (anyone's, one's own sent): its latest asked again
  watch(
    () => current.value?.lastSeq,
    (now, before) => open.value && now !== before && void load(),
  )

  /** A room shown (its draft back, the one left kept). */
  function show(id: string | undefined): void {
    if (room.value) drafts.set(room.value, text.value)
    room.value = id
    text.value = (id && drafts.get(id)) || ''
    reply.value = undefined
    picking.value = false
    messages.value = []
    void load()
  }
  async function focusInput(): Promise<void> {
    await nextTick()
    els.chatInput.value?.focus({ preventScroll: true })
    if (els.shell.value) els.shell.value.scrollTop = 0
  }
  /** The area opened on a room (none given — the one chosen, else the feed's). */
  function openChat(id?: string): void {
    hooks.closeOthers()
    open.value = true
    error.value = ''
    show(id ?? roomToShow(state.value, chosen.value))
    window.qa.islandFocus()
    void focusInput()
  }
  function close(): void {
    if (!open.value) return
    if (room.value) drafts.set(room.value, text.value)
    open.value = false
    picking.value = false
    window.qa.islandBlur()
  }
  const step = (dir: 1 | -1) => (show(stepRoom(state.value, room.value, dir)), void focusInput())
  /** A room (or the feed — '') chosen: kept for the next time, shown now. */
  function choose(id: string): void {
    void window.qa.updateSettings({ island: { chatRoom: id } })
    show(roomToShow(state.value, id))
    void focusInput()
  }
  const setOrb = (m: OrbMode) => void window.qa.updateSettings({ island: { orb: m } })

  async function send(): Promise<void> {
    const id = room.value
    const words = text.value.trim()
    if (!id || !words || sending.value) return
    sending.value = true
    try {
      await call('send', { room: id, text: words, ...(reply.value ? { reply: reply.value.seq } : {}) })
      text.value = ''
      drafts.delete(id)
      reply.value = undefined
      error.value = ''
    } catch (e) {
      error.value = remoteError(e)
    } finally {
      sending.value = false
    }
  }
  /** The room opened in the app (the island's area closed). */
  function openInApp(): void {
    if (room.value) void call('open', { room: room.value }).catch((e) => (error.value = remoteError(e)))
    close()
  }

  return { state, open, room, current, messages, picking, text, reply, error, sending, unread, orb, chosen, openChat, close, step, choose, setOrb, send, openInApp }
}
export type IslandChat = ReturnType<typeof useIslandChat>
