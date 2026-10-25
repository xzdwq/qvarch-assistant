<script setup lang="ts">
/** A room's messages (older ones on scrolling up), the ones on their way, «печатает…», the input. */
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatSendKey } from '@shared/transport/constants'
import Icon from '@renderer/components/Icon.vue'
import { cleanChatText, groupMessages, mergeRooms } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import { sendFile, sendNotes } from '@renderer/lib/chatFiles'
import ChatAttachMenu from './ChatAttachMenu.vue'
import { useChatDrafts } from './useChatDrafts'
import { chatMe, chatOnline, chatPrefs, discardMessage, isComplete, loadOlder, messagesOf, pendingOf, retryMessage, roomOf, sendMessage, showRoom, tellTyping, typingIn } from '@renderer/lib/chat'
import ChatMessageItem from './ChatMessageItem.vue'
import { useMentionInput } from './useMentionInput'

/**
 * `readonly` — the messages only (one who may read, not write: a reader of a shared note); `also` — the branches
 * whose messages are shown with this room's (a main conversation's whole feed; one writes into the room itself);
 * `height` — the messages' height, px (none — as tall as the place it is in).
 */
const props = defineProps<{ room: string; readonly?: boolean; also?: string[]; height?: number }>()
const rooms = computed(() => [props.room, ...(props.also ?? [])])
watch(
  () => (props.also ?? []).join(),
  () => (props.also ?? []).forEach((r) => void showRoom(r).catch(() => undefined)),
  { immediate: true },
)
const messages = computed(() => (props.also?.length ? mergeRooms(rooms.value.map(messagesOf)) : messagesOf(props.room)))
const groups = computed(() => groupMessages(messages.value))
/** A branch's title for its messages in the main feed. */
const branchOf = (m: { room: string }) => (m.room === props.room ? undefined : (roomOf(m.room)?.title ?? 'ветка'))
const pending = computed(() => pendingOf(props.room))
const typing = computed(() => typingIn(props.room))
const complete = computed(() => isComplete(props.room))
const me = chatMe

const list = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const text = ref('')
const members = computed(() => roomOf(props.room)?.members ?? [])
const mention = useMentionInput(text, input, () => members.value, () => me.value)
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
  for (const r of rooms.value) if (!isComplete(r)) void loadOlder(r).catch(() => undefined)
}

/** Each send key's: the key combination that sends. */
const SENDS: Record<ChatSendKey, (e: KeyboardEvent) => boolean> = {
  enter: (e) => !e.shiftKey && !e.ctrlKey,
  ctrlEnter: (e) => e.ctrlKey,
}
function onKey(e: KeyboardEvent): void {
  // «@»'s list first: its arrows, Enter, Esc
  if (mention.onKey(e)) return
  if (e.key !== 'Enter' || e.isComposing || !SENDS[chatPrefs.value.sendKey](e)) return
  e.preventDefault()
  submit()
}
// ---------- files going with the message ----------
const { drafts, refused, add: addDrafts, remove: removeDraft, onPaste, onDragOver, onDrop } = useChatDrafts()
const sending = ref(false)
const sendError = ref('')
/** The files go one by one (each a message, the words with the first); one failed — it and the rest stay to retry. */
async function sendDrafts(): Promise<void> {
  const words = cleanChatText(text.value) ?? ''
  if (text.value.trim() && !words) return void (sendError.value = 'Сообщение слишком длинное')
  sending.value = true
  sendError.value = ''
  try {
    for (const d of [...drafts.value]) {
      await sendFile(props.room, d.file, text.value.trim() ? words : '')
      text.value = ''
      removeDraft(d)
    }
  } catch (e) {
    sendError.value = remoteError(e)
  } finally {
    sending.value = false
  }
}
/** A note / a folder of the notebook sent at once (one file; the words typed go with it). */
async function sendNotesNow(rel: string, withRuns: boolean): Promise<void> {
  const words = cleanChatText(text.value) ?? ''
  sending.value = true
  sendError.value = ''
  try {
    await sendNotes(props.room, rel, withRuns, words)
    text.value = ''
    void nextTick(toBottom)
  } catch (e) {
    sendError.value = remoteError(e)
  } finally {
    sending.value = false
  }
}
function submit(): void {
  if (sending.value) return
  if (drafts.value.length) void sendDrafts().then(() => nextTick(toBottom))
  else if (sendMessage(props.room, text.value)) text.value = ''
  void nextTick(toBottom)
}
const placeholder = computed(() => (!chatOnline.value ? 'Нет связи с сервером — отправится, когда появится' : chatPrefs.value.sendKey === 'enter' ? 'Сообщение · Enter — отправить' : 'Сообщение · Ctrl+Enter — отправить'))
</script>

<template>
  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:min-h-0" @dragover="!readonly && onDragOver($event)" @drop="!readonly && onDrop($event)">
    <div ref="list" class="tw:overflow-y-auto tw:px-14 tw:pt-12 tw:pb-12" :class="{ 'tw:flex-1 tw:min-h-0': !height }" :style="height ? { height: `${height}px` } : undefined" @scroll="onScroll">
      <p v-if="complete && !messages.length" class="tw:my-20 tw:text-muted tw:text-[13px]">Сообщений пока нет</p>
      <template v-for="(m, i) in messages" :key="m.seq">
        <div v-if="newDay(i)" class="tw:my-8 tw:text-center tw:text-dim tw:text-[11.5px]">{{ day(m.at) }}</div>
        <ChatMessageItem :m="m" :me="me" :members="members" :readonly="readonly" :first="groups[i].first || newDay(i)" :last="groups[i].last || (i + 1 < messages.length && newDay(i + 1))" :branch="branchOf(m)" />
      </template>
      <!-- on their way: one's own bubbles, their state beside them (waiting for the server, going, failed) -->
      <div v-for="o in pending" :key="o.clientId" class="tw:flex tw:flex-row-reverse tw:items-end tw:gap-6 tw:mt-2">
        <div class="tw:min-w-0 tw:max-w-[78%] tw:py-5 tw:px-10 tw:rounded-[12px] tw:bg-accent/20" :class="o.failed ? 'tw:[box-shadow:inset_0_0_0_1px_var(--down)]' : 'tw:opacity-70'">
          <div class="tw:text-text tw:text-[13px] tw:leading-[1.45] tw:whitespace-pre-wrap tw:wrap-anywhere">{{ o.text }}</div>
        </div>
        <span class="tw:flex tw:flex-none tw:items-center tw:gap-2 tw:pb-1 tw:text-[10.5px]">
          <template v-if="o.failed">
            <span class="tw:max-w-160 tw:truncate tw:text-down-fg" :title="o.failed">{{ o.failed }}</span>
            <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Повторить" @click="retryMessage(o)"><Icon name="refresh" :size="12" /></button>
            <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-text" title="Убрать" @click="discardMessage(o)"><Icon name="x" :size="12" /></button>
          </template>
          <span v-else-if="!chatOnline" class="tw:inline-flex tw:items-center tw:gap-3 tw:text-dim" title="Отправится, когда будет связь с сервером"><Icon name="clock" :size="11" />ждёт связи</span>
          <span v-else class="tw:text-dim">отправляется…</span>
        </span>
      </div>
    </div>
    <div class="tw:h-18 tw:px-4 tw:text-muted tw:text-[11.5px] tw:truncate">{{ typing ? `${typing} печатает…` : '' }}</div>
    <!-- «@»: the members to mention, above the input -->
    <div v-if="!readonly && mention.options.value.length" class="tw:flex tw:flex-wrap tw:gap-4 tw:mb-6">
      <button
        v-for="(d, k) in mention.options.value"
        :key="d.id"
        class="tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-[12px] tw:[&.on]:border-accent tw:[&.on]:bg-accent/15"
        :class="{ on: k === mention.pick.value }"
        @mousedown.prevent
        @click="mention.choose(d)"
      >
        @{{ d.name }}
      </button>
    </div>
    <!-- the files going with the message: pictures as pictures -->
    <div v-if="!readonly && drafts.length" class="tw:flex tw:flex-wrap tw:gap-6 tw:mb-6">
      <span v-for="(d, k) in drafts" :key="k" class="tw:relative tw:inline-flex tw:items-center tw:gap-6 tw:h-56 tw:max-w-220 tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg/60 tw:overflow-hidden" :class="d.url ? 'tw:p-0' : 'tw:px-8'">
        <img v-if="d.url" :src="d.url" alt="" class="tw:block tw:h-full tw:w-auto tw:max-w-220 tw:object-cover" />
        <template v-else><Icon name="file" :size="16" class="tw:flex-none tw:text-muted" /><span class="tw:min-w-0 tw:truncate tw:text-[12px]">{{ d.file.name }}</span></template>
        <button class="tw:absolute tw:top-2 tw:right-2 tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border-0 tw:rounded-[9px] tw:bg-pop tw:text-muted tw:hover:text-text" title="Убрать" :disabled="sending" @click="removeDraft(d)"><Icon name="x" :size="11" /></button>
      </span>
    </div>
    <span v-if="sendError || refused" class="tw:mb-4 tw:text-down-fg tw:text-[12px]">{{ sendError || refused }}</span>
    <div v-if="!readonly" class="tw:flex tw:items-end tw:gap-8">
      <ChatAttachMenu :disabled="sending" @files="addDrafts" @notes="sendNotesNow" />
      <textarea
        ref="input"
        v-model="text"
        class="tw:flex-1 tw:min-w-0 tw:min-h-36 tw:max-h-160 tw:py-8 tw:px-10 tw:resize-none tw:text-[13px] tw:leading-[1.4] tw:field-sizing-content"
        rows="1"
        :placeholder="placeholder"
        @keydown.stop="onKey"
        @paste="onPaste"
        @input="(mention.track(), text.trim() && tellTyping(room))"
        @click="mention.track"
        @keyup="mention.track"
      ></textarea>
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0" :title="sending ? 'Отправляется…' : 'Отправить'" :disabled="sending || (!text.trim() && !drafts.length)" @click="submit"><Icon name="send" :size="15" /></button>
    </div>
  </div>
</template>
