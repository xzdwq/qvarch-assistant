<script setup lang="ts">
/**
 * A room's messages over its wall (older ones on scrolling up), the ones on their way, «печатает…», what one writes
 * (ChatComposer). An answer's quote clicked — the message it answers shown (older pages fetched till it is there).
 */
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import { groupMessages, mentionable, mergeRooms, replyOf, type ChatMessage, type ChatReply } from '@shared/transport/chat'
import { useChatPort } from './chatPort'
import ChatMessageItem from './ChatMessageItem.vue'
import ChatComposer from './ChatComposer.vue'

/**
 * `readonly` — the messages only (one who may read, not write: a reader of a shared note); `also` — the branches
 * whose messages are shown with this room's (a main conversation's whole feed; one writes into the room itself);
 * `height` — the messages' height, px (none — as tall as the place it is in).
 */
const props = defineProps<{ room: string; readonly?: boolean; also?: string[]; height?: number }>()
const chat = useChatPort()
const rooms = computed(() => [props.room, ...(props.also ?? [])])
watch(
  () => (props.also ?? []).join(),
  () => (props.also ?? []).forEach((r) => void chat.show(r).catch(() => undefined)),
  { immediate: true },
)
const messages = computed(() => (props.also?.length ? mergeRooms(rooms.value.map(chat.messagesOf)) : chat.messagesOf(props.room)))
const groups = computed(() => groupMessages(messages.value))
/** A branch's title for its messages in the main feed. */
const branchOf = (m: { room: string }) => (m.room === props.room ? undefined : (chat.roomOf(m.room)?.title ?? 'ветка'))
const pending = computed(() => chat.pendingOf(props.room))
const typing = computed(() => chat.typingIn(props.room))
/** One's own agent working here (it may be stopped). */
const working = computed(() => chat.workingIn(props.room))
const complete = computed(() => chat.isComplete(props.room))
const me = chat.me
const online = chat.online
// (people and their agents: both mentioned by «@»)
const members = computed(() => {
  const r = chat.roomOf(props.room)
  return r ? mentionable(r) : []
})

const list = ref<HTMLElement>()
const composer = ref<InstanceType<typeof ChatComposer>>()
defineExpose({ focus: () => composer.value?.focus() })
const day = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
/** A day's line above the first message of each day. */
const newDay = (i: number) => i === 0 || day(messages.value[i - 1].at) !== day(messages.value[i].at)

/** Near the bottom — a new message keeps it there; reading above — the place stays. */
const atBottom = () => !list.value || list.value.scrollHeight - list.value.scrollTop - list.value.clientHeight < 60
function toBottom(): void {
  if (list.value) list.value.scrollTop = list.value.scrollHeight
}
watch(
  () => [props.room, messages.value.length > 0],
  () => nextTick(toBottom),
  { immediate: true },
)
watch(
  () => [messages.value.at(-1)?.seq, pending.value.length, typing.value],
  () => {
    const stick = atBottom()
    void nextTick(() => stick && toBottom())
  },
)
/** Older messages come in at the top: the view stays on what was read. */
watch(
  () => messages.value[0]?.seq,
  (now, before) => {
    if (!list.value || before === undefined || now === undefined || now >= before) return
    const fromBottom = list.value.scrollHeight - list.value.scrollTop
    void nextTick(() => list.value && (list.value.scrollTop = list.value.scrollHeight - fromBottom))
  },
)
function onScroll(): void {
  if (!list.value || list.value.scrollTop >= 40) return
  // (the main feed: each of its rooms one page further back)
  for (const r of rooms.value) if (!chat.isComplete(r)) void chat.loadOlder(r).catch(() => undefined)
}

// ---------- answers ----------
const reply = ref<ChatReply>()
watch(
  () => props.room,
  () => (reply.value = undefined),
)
const answer = (m: ChatMessage) => (reply.value = replyOf(m))
/** The pages fetched back at most looking for an answered message. */
const BACK_PAGES = 20
/** The message an answer answers shown in the middle, lit a moment (not loaded yet — older pages fetched first). */
async function showMessage(room: string, seq: number): Promise<void> {
  for (let i = 0; i < BACK_PAGES && !chat.messagesOf(room).some((m) => m.seq === seq) && !chat.isComplete(room); i++) await chat.loadOlder(room).catch(() => undefined)
  await nextTick()
  const el = list.value?.querySelector<HTMLElement>(`[data-msg="${room}:${seq}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.classList.add('lit')
  setTimeout(() => el.classList.remove('lit'), 1400)
}
</script>

<template>
  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0" @dragover="!readonly && composer?.onDragOver($event)" @drop="!readonly && composer?.onDrop($event)">
    <div ref="list" class="wall tw:overflow-y-auto tw:px-14 tw:pt-12 tw:pb-12 tw:rounded-[14px]" :class="{ 'tw:flex-1 tw:min-h-0': !height }" :style="height ? { height: `${height}px` } : undefined" @scroll="onScroll">
      <p v-if="complete && !messages.length" class="tw:my-20 tw:text-center tw:text-muted tw:text-[13px]">Сообщений пока нет</p>
      <template v-for="(m, i) in messages" :key="m.seq">
        <div v-if="newDay(i)" class="tw:flex tw:justify-center tw:my-8"><span class="tw:py-2 tw:px-10 tw:rounded-full tw:bg-bg/50 tw:text-muted tw:text-[11.5px]">{{ day(m.at) }}</span></div>
        <ChatMessageItem
          :m="m"
          :me="me"
          :members="members"
          :readonly="readonly"
          :first="groups[i].first || newDay(i)"
          :last="groups[i].last || (i + 1 < messages.length && newDay(i + 1))"
          :branch="branchOf(m)"
          @reply="answer"
          @show="(seq) => showMessage(m.room, seq)"
        />
      </template>
      <!-- on their way: one's own bubbles, their state beside them (waiting for the server, going, failed) -->
      <div v-for="o in pending" :key="o.clientId" class="tw:flex tw:flex-row-reverse tw:items-end tw:gap-6 tw:mt-2">
        <div class="tw:min-w-0 tw:max-w-[78%] tw:py-6 tw:px-12 tw:rounded-[16px] tw:bg-accent/20" :class="o.failed ? 'tw:[box-shadow:inset_0_0_0_1px_var(--down)]' : 'tw:opacity-70'">
          <div v-if="o.reply" class="tw:mb-2 tw:pl-6 tw:border-l-2 tw:border-l-accent tw:text-muted tw:text-[12px] tw:truncate">{{ o.reply.author }}: {{ o.reply.text }}</div>
          <div class="tw:text-text tw:text-[13px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:wrap-anywhere">{{ o.text }}</div>
        </div>
        <span class="tw:flex tw:flex-none tw:items-center tw:gap-2 tw:pb-1 tw:text-[10.5px]">
          <template v-if="o.failed">
            <span class="tw:max-w-160 tw:truncate tw:text-down-fg" :title="o.failed">{{ o.failed }}</span>
            <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text" title="Повторить" @click="chat.retry(o)"><Icon name="refresh" :size="12" /></button>
            <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:text-text" title="Убрать" @click="chat.discard(o)"><Icon name="x" :size="12" /></button>
          </template>
          <span v-else-if="!online" class="tw:inline-flex tw:items-center tw:gap-3 tw:text-dim" title="Отправится, когда будет связь с сервером"><Icon name="clock" :size="11" />ждёт связи</span>
          <span v-else class="tw:text-dim">отправляется…</span>
        </span>
      </div>
    </div>
    <div class="tw:flex tw:items-center tw:gap-6 tw:h-20 tw:my-4 tw:px-6 tw:text-muted tw:text-[11.5px] tw:whitespace-nowrap">
      <span class="tw:min-w-0 tw:truncate">{{ working ? `${working.name} работает…` : typing }}</span>
      <button v-if="working" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-3 tw:h-20 tw:py-0 tw:px-8 tw:rounded-full tw:text-[11px]" title="Остановить ИИ" @click="chat.stopAgent(room)"><Icon name="stop" :size="9" />Стоп</button>
    </div>
    <ChatComposer v-if="!readonly" ref="composer" v-model:reply="reply" :room="room" @sent="nextTick(toBottom)" />
  </div>
</template>

<style scoped src="./ChatThread.css"></style>
