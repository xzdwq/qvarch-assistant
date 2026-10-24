<script setup lang="ts">
/**
 * A chat of the transport server in the note: the room's messages live, the input under them. The same room in two
 * notes is the same chat. Read as it is shown: on screen and with the window in front.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHAT_ROWS, chatRoomOf, ROW_PX, rowsOf, withChatRoom, withRows } from './model'
import RowsGrip from './RowsGrip.vue'
import Icon from '@renderer/components/Icon.vue'
import { branchesOf, chatOnline, chatRooms, showRoom, watchRoom } from '@renderer/lib/chat'
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
  if (transport.value.status === 'off') return 'Сервер не подключён — Настройки → Сервер и чат'
  if (!chatOnline.value && !room.value) return transport.value.message || 'Подключение к серверу…'
  if (chatOnline.value && !room.value) return 'Этого чата нет среди ваших: он удалён или вас в нём нет'
  return ''
})
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
  <div ref="el" class="tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:px-10 tw:pb-2 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <ChatHeader v-if="room" :room="room" @switched="(id) => onChange?.(withChatRoom(src, id))" />
    <span v-else class="tw:inline-flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12.5px]"><Icon name="chat" :size="14" />Чат</span>
    <span v-if="room && !chatOnline" class="tw:text-down-fg tw:text-[11.5px]">нет связи — сообщения отправятся, когда она появится</span>
    <p v-if="notice" class="tw:my-6 tw:text-muted tw:text-[13px]">{{ notice }}</p>
    <ChatThread v-if="room" :room="room.id" :also="branches" :height="rows * ROW_PX" />
    <span v-if="error" class="tw:text-down-fg tw:text-[12px]">{{ error }}</span>
    <RowsGrip v-if="room" :rows="rows" @drag="(n) => (rows = n)" @done="(n) => onChange?.(withRows(src, n))" />
  </div>
</template>
