<script setup lang="ts">
/**
 * A chat of the transport server in the note: the room's messages live, the input under them. The same room in two
 * notes is the same chat. Read as it is shown: on screen and with the window in front.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHAT_ROWS, chatRoomOf, heldTitleOf, ROW_PX, rowsOf, withChatRoom, withoutHeldTitle, withRows } from './model'
import RowsGrip from './RowsGrip.vue'
import { mayWriteIn } from './roomRights'
import Icon from '@renderer/components/Icon.vue'
import { branchesOf, chatOnline, chatRooms, holdRoom, isHeld, showRoom, watchRoom } from '@renderer/lib/chat'
import { useTransport } from '@renderer/lib/transport'
import ChatHeader from './ChatHeader.vue'
import ChatThread from './ChatThread.vue'

const props = defineProps<{ src: string; onChange?: (src: string) => void }>()
const roomId = computed(() => chatRoomOf(props.src))
const room = computed(() => chatRooms.value.find((r) => r.id === roomId.value))
/** A main conversation shows its branches' messages too (the whole feed of its people). */
const branches = computed(() => (room.value ? branchesOf(room.value.id).map((r) => r.id) : []))
const transport = useTransport()
const error = ref('')
/** The messages' height in lines: as the block keeps it; while its edge is dragged — as dragged. */
const rows = ref(rowsOf(props.src, CHAT_ROWS))
watch(
  () => props.src,
  (s) => (rows.value = rowsOf(s, CHAT_ROWS)),
)

/** Why there is nothing to show (none — the chat is shown). */
const notice = computed(() => {
  if (!roomId.value) return 'В блоке не указан чат (room: …)'
  if (room.value) return ''
  if (transport.value.status === 'off') return 'Сервер не подключён — Настройки → Сервер и чат'
  if (!chatOnline.value) return transport.value.message || 'Подключение к серверу…'
  return 'Этого чата нет среди ваших: он удалён или вас в нём нет'
})
/** The chat shown with no server: what becomes of what one writes. */
const offline = computed(() => {
  if (!room.value) return ''
  if (isHeld(room.value.id)) return 'Чат на этом компьютере · добавите человека — перейдёт на сервер со всей историей'
  if (chatOnline.value) return ''
  const later = transport.value.status === 'off' ? 'когда сервер будет подключён (Настройки → Сервер и чат)' : 'когда появится связь'
  return `Нет связи — сообщения отправятся, ${later}`
})

// a chat made with no server: held here by its block (its title in it) until the server makes it — then the title goes
watch(
  () => [roomId.value, heldTitleOf(props.src), chatRooms.value.length] as const,
  ([id, title]) => title && id && !room.value && holdRoom(id, title),
  { immediate: true },
)
watch(
  () => !!heldTitleOf(props.src) && !!room.value && !isHeld(roomId.value),
  (made) => made && props.onChange?.(withoutHeldTitle(props.src)),
  { immediate: true },
)
watch(
  () => [roomId.value, chatOnline.value, !!room.value],
  () => {
    if (!room.value) return
    error.value = ''
    showRoom(roomId.value).catch((e: Error) => (error.value = e.message))
  },
  { immediate: true },
)

/** On screen — the room is watched (its messages read as they come). */
const el = ref<HTMLElement>()
let seen = ''
const see = (on: boolean) => {
  if (seen) watchRoom(seen, false)
  seen = on ? roomId.value : ''
  if (seen) watchRoom(seen, true)
}
const io = new IntersectionObserver((es) => see(es.some((e) => e.isIntersecting)))
onMounted(() => el.value && io.observe(el.value))
watch(roomId, () => seen && see(true))
onBeforeUnmount(() => {
  io.disconnect()
  see(false)
})
</script>

<template>
  <div ref="el" class="tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:px-10 tw:pb-8 tw:border tw:border-border tw:rounded-[18px] tw:bg-panel">
    <ChatHeader v-if="room" :room="room" @switched="(id) => onChange?.(withChatRoom(src, id))" />
    <span v-else class="tw:inline-flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12.5px]"><Icon name="chat" :size="14" />Чат</span>
    <span v-if="offline" class="tw:text-muted tw:text-[11.5px]">{{ offline }}</span>
    <p v-if="notice" class="tw:my-6 tw:text-muted tw:text-[13px]">{{ notice }}</p>
    <ChatThread v-if="room" :room="room.id" :also="branches" :height="rows * ROW_PX" :readonly="!mayWriteIn(room)" />
    <span v-if="error" class="tw:text-down-fg tw:text-[12px]">{{ error }}</span>
    <RowsGrip v-if="room" :rows="rows" @drag="(n) => (rows = n)" @done="(n) => onChange?.(withRows(src, n))" />
  </div>
</template>
