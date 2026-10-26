<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { noteEntry } from '@shared/notes'
import { dayEnd, dayStart } from '@shared/timeline'
import type { Entry, Ms, Note } from '@shared/types'
import { kindColor, kindLabel } from '../lib/palette'
import Icon from './Icon.vue'
import TimeField from './TimeField.vue'
import AudioNote from './AudioNote.vue'
import { fmtSec, saveRecording, useRecorder } from '../lib/recorder'
import type { Remind } from '@shared/repeat'
import PopChip from './PopChip.vue'

/**
 * Read / write one quick note: the text is saved while typing; "done" keeps it (an emptied note is
 * removed), the trash removes it. The block it belongs to follows its time.
 */
const props = defineProps<{
  day: string
  note: { id: string; at: Ms; text: string; taskId?: string }
  entries: Entry[]
  compact?: boolean
  full?: Note
  notes?: Note[]
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
/** The host puts the date in (the calendar): then the time stands after it and the header is short. */
const dated = computed(() => !!useSlots().date)

/** A note without audio yet can be spoken (voice) or record the call; with audio — it is a text field next to the player. */
const mode = ref<'text' | 'voice' | 'call'>('text')
const { rec, sec, level, error: recError, start: startRec, stop: stopRec } = useRecorder()
/** The audio was saved here (the parent's copy of the note may not have caught up yet). */
const hasAudio = ref(!!props.full?.audio)
async function toggleRec(): Promise<void> {
  if (!rec.value) {
    await startRec(mode.value === 'call' ? 'call' : 'voice', Date.now())
    return
  }
  const r = await stopRec()
  if (!r) return
  clearTimeout(timer)
  // the note keeps its moment; the audio joins it (its text stays)
  await saveRecording(props.day, { ...r, at: at.value }, { id: props.note.id, text: text.value })
  hasAudio.value = true
  mode.value = 'text'
  emit('saved')
}

const text = ref(props.note.text)
const at = ref(props.note.at)
/** A reminder: off · at the note's moment · at a set time — its chip's text and what is saved, by the time set. */
const REMIND_MODES = {
  off: { short: () => '', remind: (): Remind | null => null },
  'at-note': { short: () => 'в момент', remind: (): Remind | null => ({ before: 0 }) },
  at: { short: (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), remind: (t: number): Remind | null => ({ at: t }) },
} satisfies Record<string, { short: (time: number) => string; remind: (time: number) => Remind | null }>
type RemindMode = keyof typeof REMIND_MODES
const remindMode = ref<RemindMode>(!props.full?.remind ? 'off' : props.full.remind.at !== undefined ? 'at' : 'at-note')
const remindTime = ref(props.full?.remind?.at ?? Math.max(Date.now(), props.note.at))
const remindOpen = ref(false)
const remindShort = computed(() => REMIND_MODES[remindMode.value].short(remindTime.value))
const remind = computed(() => REMIND_MODES[remindMode.value].remind(remindTime.value))
const area = ref<HTMLTextAreaElement>()
const target = computed(() => noteEntry({ at: at.value }, props.entries))
let timer: ReturnType<typeof setTimeout> | undefined
let closed = false

async function save(): Promise<void> {
  if (text.value.trim() || props.full?.audio || hasAudio.value) await window.qa.saveNote(props.day, { id: props.note.id, at: at.value, text: text.value, remind: remind.value })
}
watch([text, at, remind], () => {
  clearTimeout(timer)
  timer = setTimeout(() => void save(), 400)
})

async function done(): Promise<void> {
  if (closed) return
  closed = true
  clearTimeout(timer)
  if (text.value.trim()) await save()
  else if (props.full?.audio || hasAudio.value) await window.qa.saveNote(props.day, { id: props.note.id, at: at.value, text: '', remind: remind.value })
  else await window.qa.deleteNote(props.day, props.note.id) // emptied — nothing to keep
  emit('close')
}
async function remove(): Promise<void> {
  closed = true
  clearTimeout(timer)
  await window.qa.deleteNote(props.day, props.note.id)
  emit('close')
}

/** The note becomes a task: its block appears on the timeline now and the note itself goes. */
async function toTask(): Promise<void> {
  if (!text.value.trim() && !(props.full?.audio || hasAudio.value)) return
  clearTimeout(timer)
  await save()
  closed = true
  await window.qa.noteToTask(props.day, props.note.id)
  emit('saved')
  emit('close')
}

/** A second click on the note (its header, not a button or the time field) closes it. */
function onHeadClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('button, input, .tf, [contenteditable]')) void done()
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') void done()
}

onMounted(() => area.value?.focus({ preventScroll: true }))
// leaving the editor any other way (switching day / tab) still keeps what was typed
onBeforeUnmount(() => {
  if (!closed) void done()
})
watch(
  () => props.full?.audio,
  (a) => a && (hasAudio.value = true),
)
defineExpose({ focus: () => area.value?.focus({ preventScroll: true }) })
// the note's time follows a click on the timeline while it is open
watch(
  () => props.note.at,
  (t) => (at.value = t),
)
</script>

<template>
  <div class="ned tw:group/ned tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:rounded-[4px] tw:bg-warn/6 tw:border tw:border-warn/28" :class="{ compact }">
    <div class="nh tw:cursor-pointer tw:flex tw:items-center tw:gap-8 tw:text-[12px] tw:text-warn-fg" title="Клик — свернуть (сохраняется)" @click="onHeadClick">
      <Icon name="note" :size="13" class="ni tw:text-warn" />
      <span>Заметка</span>
      <template v-if="!dated">
        <TimeField compact :model-value="at" :min="dayStart(day)" :max="dayEnd(day) - 60000" @update:model-value="(t) => (at = t)" />
        <span v-if="target" class="ent tw:inline-flex tw:items-center tw:gap-5 tw:text-text tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis"><i class="tw:flex-none tw:w-8 tw:h-8 tw:rounded-[50%]" :style="{ background: kindColor(target.kind) }"></i>{{ kindLabel(target.kind) }}<template v-if="target.label && target.label !== kindLabel(target.kind)"> · {{ target.label }}</template></span>
        <span v-else class="muted small tw:text-[11px]">вне записей</span>
      </template>
      <span class="spacer tw:flex-1"></span>
      <span class="lpw" @click.stop>
        <PopChip v-model:open="remindOpen" icon="bell" :label="remindShort" :active="remindMode !== 'off'" :title="remindMode === 'off' ? 'Напомнить — уведомление Windows' : `Напоминание: ${remindShort}`">
          <button class="pci" :class="{ cur: remindMode === 'off' }" @click="(remindMode = 'off'), (remindOpen = false)">Не напоминать</button>
          <button class="pci" :class="{ cur: remindMode === 'at-note' }" @click="(remindMode = 'at-note'), (remindOpen = false)">Во время заметки</button>
          <div class="pcsep"></div>
          <div class="pcrow">
            <button class="pci" :class="{ cur: remindMode === 'at' }" @click="remindMode = 'at'">В точное время</button>
            <TimeField v-if="remindMode === 'at'" compact :model-value="remindTime" @update:model-value="(v) => (remindTime = v)" />
          </div>
        </PopChip>
      </span>
      <button v-if="!dated || full?.audio || hasAudio" class="ib task tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:cursor-pointer tw:gap-4 tw:text-[11px] tw:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3"  :title="'Сделать задачей'" @click="toTask">
        <Icon name="checkSquare" :size="14" /><span>В задачу</span>
      </button>
      <button class="ib danger tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:cursor-pointer tw:hover:text-down-fg tw:hover:bg-down/12 tw:hover:enabled:border-border-3" title="Удалить заметку" @click="remove"><Icon name="trash" :size="14" /></button>
      <button class="ib ok tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:cursor-pointer tw:text-up tw:hover:bg-up/12 tw:hover:enabled:border-border-3" title="Готово (Esc)" @click="done"><Icon name="check" :size="15" :stroke="2.4" /></button>
    </div>
    <div v-if="dated" class="ndate tw:flex tw:items-center tw:gap-8 tw:flex-nowrap tw:overflow-hidden tw:whitespace-nowrap tw:text-dim tw:text-[10.5px]">
      <slot class="tw:flex-none" name="date" />
      <TimeField class="tw:flex-none" compact :model-value="at" :min="dayStart(day)" :max="dayEnd(day) - 60000" @update:model-value="(t) => (at = t)" />
    </div>
    <AudioNote v-if="full?.audio" :day="day" :note="full" compact />
    <div v-else-if="!hasAudio" class="nmodes tw:flex tw:items-center tw:flex-wrap tw:gap-8">
      <div class="modes tw:inline-flex tw:self-start tw:border tw:border-border tw:rounded-r2 tw:overflow-hidden">
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg" :class="{ on: mode === 'text' }" :disabled="!!rec" @click="mode = 'text'"><Icon name="note" :size="12" />Текст</button>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg" :class="{ on: mode === 'voice' }" :disabled="!!rec" @click="mode = 'voice'"><Icon name="mic" :size="12" />Голос</button>
        <button class="tw:inline-flex tw:items-center tw:gap-4 tw:py-3 tw:px-10 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:bg-warn/16 tw:[&.on]:text-warn-fg" :class="{ on: mode === 'call' }" :disabled="!!rec" @click="mode = 'call'"><Icon name="phone" :size="12" />Звонок</button>
      </div>
      <button v-if="dated" class="ib task tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:cursor-pointer tw:gap-4 tw:text-[11px] tw:text-accent-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3"  :title="'Сделать задачей'" @click="toTask">
        <Icon name="checkSquare" :size="14" /><span>В задачу</span>
      </button>
    </div>
    <div v-if="mode !== 'text' && !hasAudio" class="recrow tw:flex tw:items-center tw:gap-12 tw:min-h-56">
      <button class="recbtn tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-44 tw:h-44 tw:rounded-[50%] tw:border tw:border-down/50 tw:bg-down/12 tw:text-down-fg tw:[&.on]:bg-down tw:[&.on]:text-text-hi tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:border-border-3" :class="{ on: !!rec }" :title="rec ? 'Остановить и сохранить' : mode === 'call' ? 'Записать звонок' : 'Записать голос'" @click="toggleRec">
        <Icon :name="rec ? 'stop' : mode === 'call' ? 'phone' : 'mic'" :size="16" />
      </button>
      <template v-if="rec">
        <span class="meter tw:flex-1 tw:h-6 tw:rounded-r2 tw:bg-white/8 tw:overflow-hidden"><span class="tw:block tw:h-full tw:[background:linear-gradient(90deg,var(--up),var(--warn),var(--down))]" :style="{ width: `${level * 100}%` }"></span></span>
        <b class="rt tw:tabular-nums tw:font-data">{{ fmtSec(sec) }}</b>
      </template>
      <span v-else class="muted small tw:text-[11px]">{{ mode === 'call' ? 'Звук собеседников и микрофон. Предупредите участников о записи.' : 'Нажмите и говорите — расшифровка локально' }}</span>
      <span v-if="recError" class="err tw:text-down-fg tw:text-[11px]">{{ recError }}</span>
    </div>
    <textarea class="tw:min-h-72 tw:resize-y tw:py-6 tw:px-8 tw:rounded-[4px] tw:border tw:border-warn/25 tw:bg-black/20 tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:[&&]:leading-[1.45] tw:outline-none tw:group-[.compact]/ned:min-h-56 tw:group-[.compact]/ned:resize-none tw:[&&]:group-[.compact]/ned:text-[12px] tw:focus:border-warn/55" v-if="mode === 'text' || hasAudio" ref="area" v-model="text" placeholder="Мысль, договорённость, ссылка… Поддерживается Markdown: **жирный**, - список, [ссылка](https://…)" spellcheck="false" @keydown.stop="onKey"></textarea>
  </div>
</template>

<style scoped src="./NoteEditor.css"></style>
