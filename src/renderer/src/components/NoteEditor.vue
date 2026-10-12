<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { noteEntry } from '@shared/notes'
import { dayEnd, dayStart } from '@shared/timeline'
import type { Entry, Link, LinkEnd, Ms, Note } from '@shared/types'
import { linkedTo } from '@shared/links'
import LinkPicker from './LinkPicker.vue'
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
  /** With the day's notes and links the note can be linked to blocks / other notes. */
  notes?: Note[]
  links?: Link[]
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
/** A reminder: off · at the note's moment · at a set time. */
const remindMode = ref<'off' | 'at-note' | 'at'>(!props.full?.remind ? 'off' : props.full.remind.at !== undefined ? 'at' : 'at-note')
const remindTime = ref(props.full?.remind?.at ?? Math.max(Date.now(), props.note.at))
const remindOpen = ref(false)
const remindShort = computed(() =>
  remindMode.value === 'off' ? '' : remindMode.value === 'at-note' ? 'в момент' : new Date(remindTime.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
)
const remind = computed<Remind | null>(() => (remindMode.value === 'off' ? null : remindMode.value === 'at' ? { at: remindTime.value } : { before: 0 }))
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
/** What this note is linked with — applied at once (the note is saved first, so the link has both ends). */
const linked = ref<LinkEnd[]>(props.links ? linkedTo(props.links, { type: 'note', id: props.note.id }).map((x) => x.other) : [])
async function setLinked(v: LinkEnd[]): Promise<void> {
  linked.value = v
  clearTimeout(timer)
  await window.qa.saveNote(props.day, { id: props.note.id, at: at.value, text: text.value })
  await window.qa.setLinks(props.day, { type: 'note', id: props.note.id }, v.map((l) => ({ type: l.type, id: l.id })))
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
  <div class="ned" :class="{ compact }">
    <div class="nh" title="Клик — свернуть (сохраняется)" @click="onHeadClick">
      <Icon name="note" :size="13" class="ni" />
      <span>Заметка</span>
      <template v-if="!dated">
        <TimeField compact :model-value="at" :min="dayStart(day)" :max="dayEnd(day) - 60000" @update:model-value="(t) => (at = t)" />
        <span v-if="target" class="ent"><i :style="{ background: kindColor(target.kind) }"></i>{{ kindLabel(target.kind) }}<template v-if="target.label && target.label !== kindLabel(target.kind)"> · {{ target.label }}</template></span>
        <span v-else class="muted small">вне записей</span>
      </template>
      <span class="spacer"></span>
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
      <span v-if="notes && links" class="lpw" @click.stop>
        <LinkPicker :model-value="linked" :entries="entries" :notes="notes" :self="{ type: 'note', id: note.id }" compact @update:model-value="setLinked" />
      </span>
      <button v-if="!dated || full?.audio || hasAudio" class="ib task"  :title="'Сделать задачей'" @click="toTask">
        <Icon name="checkSquare" :size="14" /><span>В задачу</span>
      </button>
      <button class="ib danger" title="Удалить заметку" @click="remove"><Icon name="trash" :size="14" /></button>
      <button class="ib ok" title="Готово (Esc)" @click="done"><Icon name="check" :size="15" :stroke="2.4" /></button>
    </div>
    <div v-if="dated" class="ndate">
      <slot name="date" />
      <TimeField compact :model-value="at" :min="dayStart(day)" :max="dayEnd(day) - 60000" @update:model-value="(t) => (at = t)" />
    </div>
    <AudioNote v-if="full?.audio" :day="day" :note="full" compact />
    <div v-else-if="!hasAudio" class="nmodes">
      <div class="modes">
        <button :class="{ on: mode === 'text' }" :disabled="!!rec" @click="mode = 'text'"><Icon name="note" :size="12" />Текст</button>
        <button :class="{ on: mode === 'voice' }" :disabled="!!rec" @click="mode = 'voice'"><Icon name="mic" :size="12" />Голос</button>
        <button :class="{ on: mode === 'call' }" :disabled="!!rec" @click="mode = 'call'"><Icon name="phone" :size="12" />Звонок</button>
      </div>
      <button v-if="dated" class="ib task"  :title="'Сделать задачей'" @click="toTask">
        <Icon name="checkSquare" :size="14" /><span>В задачу</span>
      </button>
    </div>
    <div v-if="mode !== 'text' && !hasAudio" class="recrow">
      <button class="recbtn" :class="{ on: !!rec }" :title="rec ? 'Остановить и сохранить' : mode === 'call' ? 'Записать звонок' : 'Записать голос'" @click="toggleRec">
        <Icon :name="rec ? 'stop' : mode === 'call' ? 'phone' : 'mic'" :size="16" />
      </button>
      <template v-if="rec">
        <span class="meter"><span :style="{ width: `${level * 100}%` }"></span></span>
        <b class="rt">{{ fmtSec(sec) }}</b>
      </template>
      <span v-else class="muted small">{{ mode === 'call' ? 'Звук собеседников и микрофон. Предупредите участников о записи.' : 'Нажмите и говорите — расшифровка локально' }}</span>
      <span v-if="recError" class="err">{{ recError }}</span>
    </div>
    <textarea v-if="mode === 'text' || hasAudio" ref="area" v-model="text" placeholder="Мысль, договорённость, ссылка… Поддерживается Markdown: **жирный**, - список, [ссылка](https://…)" spellcheck="false" @keydown.stop="onKey"></textarea>
  </div>
</template>

<style scoped>
.ned {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.28);
}
.nh {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #fde68a;
}
.ni {
  color: #fbbf24;
}
.ent {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ent i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.small {
  font-size: 11px;
}
.spacer {
  flex: 1;
}
.lpw :deep(.chip) {
  height: 26px;
  min-width: 26px;
  padding: 0 7px;
  font-size: 11px;
}
.ib {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.ib.danger:hover {
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
}
.ib.task {
  gap: 4px;
  font-size: 11px;
  color: #a5b4fc;
}
.ib.task.linked {
  color: #86efac;
}
.nrem {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.nrem select {
  padding: 3px 6px;
  border-radius: 7px;
  font-size: 12px;
}
.lpw :deep(.pchip) {
  height: 28px;
  padding: 0 7px;
}
.ndate,
.nmodes {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ndate {
  flex-wrap: nowrap;
}
.ndate > * {
  flex: none;
}
.ndate :deep(.pdate-row) {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
}
.ndate :deep(.pdate) {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
}
.modes {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
}
.modes button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.modes button.on {
  background: rgba(253, 230, 138, 0.16);
  color: #fde68a;
}
.recrow {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
}
.recbtn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.12);
  color: #fca5a5;
}
.recbtn.on {
  background: #ef4444;
  color: #fff;
}
.meter {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #facc15, #ef4444);
}
.rt {
  font-variant-numeric: tabular-nums;
}
.err {
  color: #f87171;
  font-size: 11px;
}
.ib.ok {
  color: #4ade80;
}
.ib.ok:hover {
  background: rgba(74, 222, 128, 0.12);
}
textarea {
  min-height: 72px;
  resize: vertical;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(253, 230, 138, 0.25);
  background: rgba(0, 0, 0, 0.2);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  outline: none;
}
.compact textarea {
  min-height: 56px;
  resize: none;
  font-size: 12px;
}
textarea:focus {
  border-color: rgba(253, 230, 138, 0.55);
}
</style>
