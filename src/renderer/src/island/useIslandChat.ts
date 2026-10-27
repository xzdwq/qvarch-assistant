import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import { NO_ISLAND_CHAT, roomToShow, stepRoom, type IslandChatState, type IslandPanelView, type OrbMode } from '@shared/islandChat'
import { remoteError } from '@shared/remoteError'
import { provideChatPort } from '@nb/blocks/chat/chatPort'
import { askChats, islandChatPort } from './islandChatPort'
import type { IslandSettings } from './useIslandSettings'

/**
 * The chats in the island: their unread count (always shown — notifications on or off), and a room's whole chat (the
 * same parts as a note's: files, voices, answers, reactions, «@» for people and AI) — next to the pill (the orb or the
 * count opens it) or instead of the day in the unfolded island (its view, kept). The room shown stays while it is in
 * sight (messages of other rooms never switch it); the rooms may be browsed by hand, the room (or the feed) chosen is
 * kept. The main window holds the chats: the island shows the room it mirrors and asks it to act.
 */
export function useIslandChat(island: IslandSettings, expanded: Ref<boolean>, hooks: { closeOthers: () => void }) {
  const state = shallowRef<IslandChatState>(NO_ISLAND_CHAT)
  void window.qa.islandChatGet().then((s) => (state.value = s))
  onBeforeUnmount(window.qa.onIslandChat((s) => (state.value = s)))
  // the chat parts of the island work with the mirrored chats
  provideChatPort(islandChatPort(state))

  /** The chat next to the pill is open. */
  const open = ref(false)
  /** The room shown (kept while in sight). */
  const room = ref<string>()
  /** The rooms' list shown instead of the chat (to choose one, or the feed). */
  const picking = ref(false)
  const error = ref('')

  const orb = computed<OrbMode>(() => island.settings.value?.island.orb ?? 'note')
  /** What the unfolded island shows (kept). */
  const panelView = computed<IslandPanelView>(() => island.settings.value?.island.panelView ?? 'day')
  /** The room chosen ('' — the feed). */
  const chosen = computed(() => island.settings.value?.island.chatRoom ?? '')
  const current = computed(() => state.value.rooms.find((r) => r.id === room.value))
  /** The room's whole chat is here (mirrored). */
  const ready = computed(() => !!room.value && state.value.shown?.room.id === room.value)
  const unread = computed(() => state.value.unread)
  /** A chat is in sight: next to the pill, or the unfolded island's view. */
  const inSight = computed(() => open.value || (expanded.value && panelView.value === 'chat'))

  // the room in sight mirrored (and read as it comes); none in sight — none
  watch(
    () => (inSight.value ? (room.value ?? '') : ''),
    (id) =>
      void askChats('show', { room: id }).then(
        () => (error.value = ''),
        (e) => (error.value = remoteError(e)),
      ),
  )
  // in sight with no room yet (the first rooms came, the view switched): the chosen one, else the feed's
  watch(
    () => [inSight.value, state.value.rooms.length] as const,
    ([on]) => on && !current.value && (room.value = roomToShow(state.value, chosen.value)),
  )

  /** A room shown (none given — the one chosen, else the feed's). */
  function show(id: string | undefined): void {
    room.value = id
    picking.value = false
  }
  /** The chat next to the pill opened (on a room, or the one chosen / the feed's). */
  function openChat(id?: string): void {
    hooks.closeOthers()
    open.value = true
    error.value = ''
    show(id ?? roomToShow(state.value, chosen.value))
    window.qa.islandFocus()
  }
  function close(): void {
    if (!open.value) return
    open.value = false
    picking.value = false
    window.qa.islandBlur()
  }
  const step = (dir: 1 | -1) => show(stepRoom(state.value, room.value, dir))
  /** A room (or the feed — '') chosen: kept for the next time, shown now. */
  function choose(id: string): void {
    void window.qa.updateSettings({ island: { chatRoom: id } })
    show(roomToShow(state.value, id))
  }
  const setOrb = (m: OrbMode) => void window.qa.updateSettings({ island: { orb: m } })
  /** The unfolded island's view chosen (kept). */
  const setPanelView = (v: IslandPanelView) => void window.qa.updateSettings({ island: { panelView: v } })

  /** The room opened in the app (the chat next to the pill closed); it could not be (in no note) — said here. */
  function openInApp(): void {
    if (!room.value) return
    error.value = ''
    void askChats('open', { room: room.value }).then(close, (e) => (error.value = remoteError(e)))
  }
  /** A chat in none of one's notes taken away (asked first); the one shown — the next one shown. */
  function remove(id: string, title: string): void {
    if (!confirm(`Удалить чат «${title}»? Он не стоит ни в одной заметке. Если в нём есть другие люди — у них он останется, у вас исчезнет; если вы в нём один — удалится полностью, со всеми сообщениями и файлами.`)) return
    void askChats('remove', { room: id }).then(
      () => room.value === id && show(stepRoom(state.value, id, 1)),
      (e) => (error.value = remoteError(e)),
    )
  }

  return { state, open, room, current, ready, picking, error, unread, orb, panelView, chosen, inSight, openChat, close, step, choose, setOrb, setPanelView, openInApp, remove }
}
export type IslandChat = ReturnType<typeof useIslandChat>
