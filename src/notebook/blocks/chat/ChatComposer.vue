<script setup lang="ts">
/**
 * What one writes into a room, as messengers have it: the message answered (over the input, ✕ — not answering), the
 * members to mention, the files going with it, a round input; an empty input — the microphone (a voice message:
 * recorded, then sent or dropped), else — send.
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatSendKey } from '@shared/transport/constants'
import { cleanChatText, callable, clockSec, type ChatReply } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import Icon from '@renderer/components/Icon.vue'
import { useEscLayer } from '@renderer/lib/usePopover'
import { useDraft } from '@renderer/lib/drafts'
import ChatAttachMenu from './ChatAttachMenu.vue'
import HarnessRoomSettings from './HarnessRoomSettings.vue'
import { useChatPort } from './chatPort'
import { useChatDrafts } from './useChatDrafts'
import { useMentionInput } from './useMentionInput'
import { useVoiceRecord } from './useVoiceRecord'

const props = defineProps<{ room: string }>()
const reply = defineModel<ChatReply | undefined>('reply')
const emit = defineEmits<{ sent: [] }>()
const chat = useChatPort()
const { me, online: chatOnline, prefs: chatPrefs } = chat

const input = ref<HTMLTextAreaElement>()
// (not sent yet — kept for the room: back from another note or section, after a restart too)
const text = useDraft(() => `chat:${props.room}`, { keep: true })
// (the people, one's own agents and the others' ones open to all: mentioned by «@»)
const members = computed(() => {
  const r = chat.roomOf(props.room)
  return r ? callable(r, me.value) : []
})
const mention = useMentionInput(text, input, () => members.value, () => me.value)

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
defineExpose({ onDragOver, onDrop, focus: () => input.value?.focus() })
const sending = ref(false)
const sendError = ref('')
/** Something sent: the answer is done, the room shows its end. */
function done(): void {
  reply.value = undefined
  emit('sent')
}
/** A sending step: busy meanwhile, a failure said. */
async function withSending(fn: () => Promise<void>): Promise<void> {
  sending.value = true
  sendError.value = ''
  try {
    await fn()
    done()
  } catch (e) {
    sendError.value = remoteError(e)
  } finally {
    sending.value = false
  }
}
/** The files go one by one (each a message, the words and the answer with the first); one failed — it and the rest stay to retry. */
function sendDrafts(): Promise<void> {
  const words = cleanChatText(text.value) ?? ''
  if (text.value.trim() && !words) return Promise.resolve(void (sendError.value = 'Сообщение слишком длинное'))
  return withSending(async () => {
    for (const d of [...drafts.value]) {
      await chat.sendFile(props.room, d.file, text.value.trim() ? words : '', reply.value)
      text.value = ''
      reply.value = undefined
      removeDraft(d)
    }
  })
}
/** A note / a folder of the notebook sent at once (one file; the words typed go with it). */
function sendNotesNow(rel: string, withRuns: boolean): Promise<void> {
  const words = cleanChatText(text.value) ?? ''
  return withSending(async () => {
    await chat.sendNotes(props.room, rel, withRuns, words)
    text.value = ''
  })
}
// ---------- harness: the message is the goal of a run (the agent plans, works and checks until it is done) ----------
const harness = chat.harness
const harnessOn = ref(false)
/** The harness may be started here: one's own agent is in the room, no run is going on. */
const canHarness = computed(() => {
  const run = harness?.runOf(props.room)
  return !!harness?.canStart(props.room) && (!run || run.phase === 'done' || run.phase === 'stopped')
})
watch(canHarness, (can) => !can && (harnessOn.value = false))
function startHarness(): void {
  const why = harness?.start(props.room, text.value)
  if (why) return void (sendError.value = why)
  text.value = ''
  harnessOn.value = false
  sendError.value = ''
  done()
}
function submit(): void {
  if (sending.value) return
  if (harnessOn.value && canHarness.value) return startHarness()
  if (drafts.value.length) return void sendDrafts()
  if (chat.send(props.room, text.value, reply.value)) {
    text.value = ''
    done()
  }
}
// ---------- a voice message ----------
// (the mentions typed go with it as its words: those mentioned are told)
const voice = useVoiceRecord((blob, sec) =>
  withSending(async () => {
    await chat.sendVoice(props.room, blob, sec, reply.value, text.value.trim())
    text.value = ''
  }),
)
useEscLayer(voice.recording, voice.cancel)
const canVoice = computed(() => !chat.isHeld(props.room) && chatOnline.value)
const empty = computed(() => !text.value.trim() && !drafts.value.length)
/** Nothing typed but mentions (`@Имя`): a voice message may go — with them. */
const onlyMentions = computed(() => !drafts.value.length && !members.value.reduce((t, m) => t.split(`@${m.name}`).join(''), text.value).trim())
// (an answer picked: the input is where one writes it)
watch(reply, (r) => r && void nextTick(() => input.value?.focus()))

const placeholder = computed(() => (harnessOn.value ? 'Цель работы · ИИ составит план и будет работать до результата' : !chatOnline.value && !chat.isHeld(props.room) ? 'Нет связи с сервером — ИИ ответит, людям уйдёт, когда появится связь' : chatPrefs.value.sendKey === 'enter' ? 'Сообщение · Enter — отправить' : 'Сообщение · Ctrl+Enter — отправить'))
</script>

<template>
  <div class="tw:flex tw:flex-col tw:gap-6">
    <!-- the message answered -->
    <div v-if="reply" class="tw:flex tw:items-center tw:gap-8 tw:min-w-0 tw:py-4 tw:pr-4 tw:pl-10 tw:rounded-[14px] tw:bg-accent/10">
      <Icon name="reply" :size="14" class="tw:flex-none tw:text-accent-fg" />
      <span class="tw:flex tw:flex-col tw:min-w-0 tw:flex-1 tw:pl-8 tw:border-l-2 tw:border-l-accent">
        <b class="tw:text-accent-fg tw:text-[12px] tw:truncate">{{ reply.author }}</b>
        <span class="tw:text-muted tw:text-[12px] tw:truncate">{{ reply.text || 'сообщение' }}</span>
      </span>
      <button class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Не отвечать" @click="reply = undefined"><Icon name="x" :size="12" /></button>
    </div>
    <!-- «@»: the members to mention -->
    <div v-if="mention.options.value.length" class="tw:flex tw:flex-wrap tw:gap-4">
      <button
        v-for="(d, k) in mention.options.value"
        :key="d.id"
        class="tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-full tw:bg-transparent tw:text-[12px] tw:[&.on]:border-accent tw:[&.on]:bg-accent/15"
        :class="{ on: k === mention.pick.value }"
        @mousedown.prevent
        @click="mention.choose(d)"
      >
        @{{ d.name }}
      </button>
    </div>
    <!-- the files going with the message: pictures as pictures -->
    <div v-if="drafts.length" class="tw:flex tw:flex-wrap tw:gap-6">
      <span v-for="(d, k) in drafts" :key="k" class="tw:relative tw:inline-flex tw:items-center tw:gap-6 tw:h-56 tw:max-w-220 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-bg/60 tw:overflow-hidden" :class="d.url ? 'tw:p-0' : 'tw:px-10'">
        <img v-if="d.url" :src="d.url" alt="" class="tw:block tw:h-full tw:w-auto tw:max-w-220 tw:object-cover" />
        <template v-else><Icon name="file" :size="16" class="tw:flex-none tw:text-muted" /><span class="tw:min-w-0 tw:truncate tw:text-[12px]">{{ d.file.name }}</span></template>
        <button class="tw:absolute tw:top-2 tw:right-2 tw:inline-flex tw:items-center tw:justify-center tw:w-18 tw:h-18 tw:p-0 tw:border-0 tw:rounded-full tw:bg-pop tw:text-muted tw:hover:text-text" title="Убрать" :disabled="sending" @click="removeDraft(d)"><Icon name="x" :size="11" /></button>
      </span>
    </div>
    <span v-if="sendError || refused || voice.error.value" class="tw:text-down-fg tw:text-[12px]">{{ sendError || refused || voice.error.value }}</span>
    <div class="tw:flex tw:items-end tw:gap-6">
      <ChatAttachMenu :disabled="sending || voice.recording.value" @files="addDrafts" @notes="sendNotesNow" />
      <button
        v-if="canHarness && !voice.recording.value"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg"
        :class="{ on: harnessOn }"
        :title="harnessOn ? 'Режим harness: сообщение — цель работы (выключить)' : 'Режим harness: ИИ составит план с критериями и будет работать по шагам, сам проверяя результат'"
        @click="harnessOn = !harnessOn"
      >
        <Icon name="repeat" :size="15" />
      </button>
      <!-- the work about to start: this chat's settings for it -->
      <HarnessRoomSettings v-if="harnessOn && canHarness && !voice.recording.value" :room="room" :size="15" />

      <!-- recording: its time and level instead of the input -->
      <div v-if="voice.recording.value" class="tw:flex tw:flex-1 tw:items-center tw:gap-10 tw:min-w-0 tw:h-36 tw:px-14 tw:rounded-[18px] tw:bg-panel-3">
        <span class="tw:w-10 tw:h-10 tw:flex-none tw:rounded-full tw:bg-down tw:animate-pulse"></span>
        <span class="tw:font-data tw:text-[13px] tw:text-text">{{ clockSec(voice.sec.value) }}</span>
        <span class="tw:flex-1 tw:h-4 tw:rounded-full tw:bg-text/10 tw:overflow-hidden"><span class="tw:block tw:h-full tw:bg-accent tw:transition-[width]" :style="{ width: `${Math.round(voice.level.value * 100)}%` }"></span></span>
        <button class="tw:h-26 tw:py-0 tw:px-10 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:text-[12px] tw:hover:bg-hover tw:hover:text-text" title="Не отправлять (Esc)" @click="voice.cancel">Отмена</button>
      </div>
      <textarea
        v-else
        ref="input"
        v-model="text"
        class="tw:flex-1 tw:min-w-0 tw:min-h-36 tw:max-h-160 tw:py-8 tw:px-14 tw:rounded-[18px] tw:resize-none tw:text-[13px] tw:leading-[1.4] tw:field-sizing-content"
        rows="1"
        :placeholder="placeholder"
        @keydown.stop="onKey"
        @paste="onPaste"
        @input="(mention.track(), text.trim() && chat.tellTyping(room))"
        @click="mention.track"
        @keyup="mention.track"
      ></textarea>
      <button v-if="voice.recording.value" class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-accent tw:text-white tw:hover:brightness-110" title="Отправить голосовое" @click="voice.finish"><Icon name="send" :size="15" /></button>
      <button
        v-else-if="onlyMentions && canVoice"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text"
        title="Записать голосовое"
        :disabled="sending"
        @click="voice.start"
      >
        <Icon name="mic" :size="16" />
      </button>
      <button v-else class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-36 tw:h-36 tw:p-0 tw:border-0 tw:rounded-full tw:bg-accent tw:text-white tw:hover:enabled:brightness-110 tw:disabled:opacity-50" :title="sending ? 'Отправляется…' : 'Отправить'" :disabled="sending || empty" @click="submit"><Icon name="send" :size="15" /></button>
    </div>
  </div>
</template>
