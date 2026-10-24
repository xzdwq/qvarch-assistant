<script setup lang="ts">
import NoteLinks from './NoteLinks.vue'
import { openUrl } from '../lib/links'
import { computed, ref, watch } from 'vue'
import { formatDuration, joinTitle } from '@shared/timeline'
import type { Entry, Ms, Note } from '@shared/types'
import { kindLabel } from '../lib/palette'
import LabelInput, { type Recent } from './LabelInput.vue'
import TaskPicker from './TaskPicker.vue'
import DictateButton from './DictateButton.vue'
import Icon from './Icon.vue'
import TimeRange from './TimeRange.vue'
import TimeField from './TimeField.vue'
import OffsetField from './OffsetField.vue'
import PopChip from './PopChip.vue'
import { beforeLabel, REMIND_BEFORE, REPEAT_RULES } from '@shared/repeat'
import QuickField from './QuickField.vue'
import DatePick from './DatePick.vue'
import type { AddPlacement, EntryDraft } from '../tracker/entry/entryTypes'
import { useEntryForm } from '../tracker/entry/useEntryForm'
import { useEntryReminder } from '../tracker/entry/useEntryReminder'
import { useEntryActions } from '../tracker/entry/useEntryActions'
import EntryCopyMenu from '../tracker/entry/EntryCopyMenu.vue'
import { useRecording } from '../tracker/entry/useRecording'
import RecDot from './RecDot.vue'
import AttrPicker from '../tracker/entry/AttrPicker.vue'
import { useEntryAutosave } from '../tracker/entry/useEntryAutosave'

/**
 * The event card: date, times, kind, text, tasks, reminder / repeat. A new event is added by the button; an
 * existing one saves itself when the card is left.
 */
/** followsNow — the end is "now" (N minutes back); startsNow — the start is "now" (N minutes ahead). */
export type Draft = EntryDraft
/** How a new block without a picked range is placed: from now / the cursor, forward or back, N minutes. */
export type AddPrefs = AddPlacement

const props = defineProps<{
  day: string
  entry: Draft
  recent: Recent[]
  now?: Ms
  entries: Entry[]
  notes: Note[]
  /** Shown for a new block without a range picked on the timeline. */
  add?: AddPrefs
  /** A moment was clicked on the timeline ("от курсора" is possible). */
  hasCursor?: boolean
  /** A plain multi-line field (Enter — a new line, the height can be pulled) instead of the one-line input. */
  textarea?: boolean
  /** Saved only by the button (a modal form) — no autosave. */
  manual?: boolean
}>()
const emit = defineEmits<{
  /** `day` — where it is now (another day when its date was changed). */
  saved: [e: Entry, day: string]
  /** A copy made on the picked date (the edited event stays). */
  copied: [e: Entry, day: string]
  /** A new event's date was changed — the host may move its marker there. */
  day: [d: string]
  deleted: []
  close: []
  /** Draft times changed in the form → move the marker on the timeline. */
  range: [r: { start: Ms; end: Ms; followsNow: boolean }]
  'update:add': [a: AddPrefs]
}>()

const form = useEntryForm(props, emit)
const { start, followsNow, startsNow, label, kind, tasks, attrs, error, busy, copied, parsed, isNew, readonly, date, setDate, addTask, effectiveEnd, setRange, shown } = form
const reminder = useEntryReminder(props, start)
const { remindMode, remindTime, repeatRule, repeatCount, remindOpen, repeatOpen, remindShort, repeatShort, seriesText } = reminder
const actions = useEntryActions(props, emit, form, reminder)
const { save, copySource, copiedTo, onCopied, remove } = actions
const rootEl = ref<HTMLElement>()
const { saveState, flush, onFocusOut, close } = useEntryAutosave(props, emit, form, reminder, actions, rootEl)

const labelInput = ref<InstanceType<typeof LabelInput>>()
const quickEl = ref<InstanceType<typeof QuickField>>()
const area = ref<HTMLTextAreaElement>()
defineExpose({
  focus: () => (isNew.value ? quickEl.value?.focus() : props.textarea ? area.value?.focus() : labelInput.value?.focus()),
  /** "Continue that topic": take kind and text of another entry. */
  copyFrom: (e: Pick<Entry, 'kind' | 'label' | 'description'>) => {
    kind.value = e.kind
    label.value = joinTitle(e.label, e.description)
    copied.value = `${kindLabel(e.kind)} · ${e.label}`
    if (props.textarea) area.value?.focus()
    else labelInput.value?.focus()
  },
})

function setAdd(p: Partial<AddPrefs>): void {
  if (props.add) emit('update:add', { ...props.add, ...p })
}
const openJoin = (url: string) => openUrl(url)
/** «Запись» of this event: stopped / started (going on or ahead) — the card shows it as the day comes back. */
const rec = useRecording()
const recordAction = computed(() => (props.entry.id ? rec.action({ ...props.entry, recording: props.entry.recording }, props.now ?? Date.now()) : undefined))
async function toggleRecording(): Promise<void> {
  if (!props.entry.id) return
  try {
    await rec.set(props.day, props.entry.id, !props.entry.recording)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
/** Time already spent on the picked task (all days) — the same task taken again adds up. */
const taskTotals = ref<Record<string, number>>({})
watch(
  () => tasks.value[0]?.key,
  async (k) => {
    if (k) taskTotals.value = await window.qa.jiraTracked()
  },
  { immediate: true },
)
</script>

<template>
  <div ref="rootEl" class="editor tw:flex tw:flex-col tw:gap-10 tw:[.field>&]:first:flex-1 tw:[.field>&]:first:min-w-0" @keydown.ctrl.enter="entry.id && !manual ? flush() : save()" @focusout="onFocusOut">
    <div class="head tw:flex tw:items-center tw:gap-4">
      <h3 class="tw:m-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">{{ entry.id ? 'Событие' : 'Новое событие' }}</h3>
      <span v-if="entry.source === 'ai'" class="badge tw:text-[10px] tw:py-2 tw:px-6 tw:rounded-r2 tw:bg-accent">AI</span>
      <span v-if="entry.outlook" class="badge ol tw:text-[10px] tw:py-2 tw:px-6 tw:rounded-r2 tw:bg-info" :title="entry.outlook.organizer ? `Из Outlook · организатор ${entry.outlook.organizer}` : 'Из Outlook'">Outlook</span>
      <button v-if="entry.outlook?.joinUrl && (now ?? 0) < entry.end" class="join tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-8 tw:rounded-r2 tw:text-[12px] tw:text-accent-fg" title="Подключиться к встрече в Teams" @click="openJoin(entry.outlook.joinUrl)"><Icon name="users" :size="13" />Teams</button>
      <span class="spacer tw:flex-1"></span>
      <span v-if="entry.series" class="badge rep tw:text-[10px] tw:py-2 tw:px-6 tw:rounded-r2 tw:inline-flex tw:items-center tw:gap-4 tw:bg-accent/25 tw:text-accent-fg" :title="`Повторяется ${seriesText} — изменения можно применить ко всей серии`"><Icon name="repeat" :size="11" />{{ seriesText }}</span>
      <button v-if="entry.id && recordAction" class="hbtn rec tw:inline-flex tw:items-center tw:justify-center tw:gap-5 tw:h-28 tw:py-0 tw:px-7 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:hover:bg-hover tw:hover:text-down-fg tw:[&.on]:text-down-fg" :class="{ on: entry.recording }" :title="entry.recording ? 'Остановить запись: событие закончится сейчас' : 'Начать запись: конец события будет продлеваться сам (будущее — когда наступит его время)'" @click="toggleRecording"><RecDot v-if="entry.recording" /><Icon :name="entry.recording ? 'stop' : 'rec'" :size="13" />{{ entry.recording ? 'Запись' : '' }}</button>
      <button v-if="entry.id && !readonly" class="hbtn danger tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-down-fg tw:hover:enabled:border-border-3" title="Удалить событие" @click="remove"><Icon name="trash" :size="15" /></button>
      <!-- a new block's form is always there — nothing to close -->
      <button v-if="entry.id" class="hbtn tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Закрыть (Esc)" @click="close"><Icon name="x" :size="16" /></button>
    </div>
    <div v-if="readonly" class="ro tw:flex tw:items-center tw:gap-6 tw:-mt-4 tw:py-6 tw:px-9 tw:rounded-[4px] tw:bg-info/14 tw:text-info-fg tw:text-[12px]"><Icon name="outlook" :size="13" />Встреча из Outlook — время, название и вид меняет только Outlook. Здесь — напоминание.</div>

    <!-- the date: a new event is added there; an existing one is moved there (once the card is left); «Копия» — its own place -->
    <div class="drow tw:flex tw:items-center tw:gap-8">
      <span v-if="readonly" class="rodate tw:inline-flex tw:items-center tw:gap-6 tw:text-text-2 tw:font-data tw:text-[12px]"><Icon name="calendar" :size="13" />{{ new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) }}</span>
      <DatePick v-else parts :model-value="date" @update:model-value="setDate" />
      <span v-if="entry.id && !readonly && date !== day" class="moved tw:text-warn-fg tw:text-[12px]">перенесётся</span>
      <EntryCopyMenu v-if="entry.id && !readonly" class="tw:ml-auto" :day="day" :source="copySource" label="Копия" :disabled="busy" @copied="onCopied" />
    </div>
    <!-- when: one line; for a new block — quiet presets right under it -->
    <div v-if="readonly" class="when tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
      <b class="rot tw:tabular-nums tw:font-data tw:text-[15px]">{{ new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }} – {{ new Date(effectiveEnd).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</b>
      <span class="dur tw:font-semibold tw:tabular-nums tw:font-data">{{ formatDuration(effectiveEnd - start) }}</span>
    </div>
    <div v-else class="when tw:flex tw:items-center tw:gap-8 tw:flex-wrap">
      <TimeRange boxed :start="start" :end="effectiveEnd" :live-start="startsNow" :live-end="followsNow" @change="setRange" />
    </div>
    <div v-if="add && !readonly" class="presets tw:flex tw:items-center tw:flex-wrap tw:gap-2 tw:-mt-4">
      <button
        class="pill tw:inline-flex tw:items-center tw:gap-3 tw:py-3 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:text-text tw:text-accent-fg"
        :title="add.from === 'now' ? 'От текущего момента' : 'От курсора на таймлайне'"
        :disabled="!hasCursor && add.from === 'now'"
        @click="setAdd({ from: add.from === 'now' ? 'cursor' : 'now' })"
      >
        <Icon :name="add.from === 'now' ? 'clock' : 'pin'" :size="12" />{{ add.from === 'now' ? (now ? 'сейчас' : '09:00') : 'курсор' }}
      </button>
      <OffsetField :model-value="add.back ? -add.min : add.min" @update:model-value="(v) => setAdd({ back: v < 0, min: Math.abs(v) })" />
    </div>

    <!-- the kind first, right above the text -->
    <div v-if="!readonly" class="kinds tw:flex tw:flex-wrap tw:gap-4" role="radiogroup" aria-label="Вид занятости">
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:min-w-30 tw:h-28 tw:py-0 tw:px-8 tw:rounded-[4px] tw:border tw:border-border tw:bg-transparent tw:text-(--kc,var(--muted)) tw:text-[12px] tw:[transition:background_0.15s,color_0.15s] tw:hover:[&:not(.on)]:bg-hover tw:[&.on]:text-text-hi tw:[&.on]:font-semibold"
        v-for="k in shown"
        :key="k.id"
        role="radio"
        :aria-checked="kind === k.id"
        :class="{ on: kind === k.id }"
        :style="kind === k.id ? { background: k.color, borderColor: k.color } : { '--kc': k.color }"
        :title="k.label"
        @click="kind = k.id"
      >
        <Icon :name="k.icon" :size="13" />
        <span v-if="kind === k.id">{{ k.label }}</span>
      </button>
    </div>

    <div v-if="readonly" class="rotitle tw:flex tw:flex-col tw:gap-2 tw:text-[14px] tw:font-semibold">{{ entry.label }}<span v-if="entry.description" class="muted tw:text-[12px] tw:font-normal tw:whitespace-pre-wrap">{{ entry.description }}</span></div>
    <QuickField
      v-else-if="isNew"
      ref="quickEl"
      v-model="label"
      :day="date"
      :enter-newline="textarea"
      :rows="textarea ? 3 : 1"
      @submit="save()"
      @kind="(k) => (kind = k)"
      @task="addTask"
      @parsed="(p) => (parsed = p)"
    />
    <textarea
      v-else-if="textarea"
      ref="area"
      v-model="label"
      class="ta tw:box-border tw:w-full tw:min-h-64 tw:max-h-420 tw:py-8 tw:px-10 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:[&&]:leading-[1.45] tw:resize-y tw:outline-none tw:focus:border-accent"
      rows="3"
      spellcheck="false"
      title="Первая строка"
      @keydown.ctrl.enter.prevent="save()"
    ></textarea>
    <LabelInput
      v-else
      ref="labelInput"
      v-model="label"
      multiline
      placeholder="Что делали? Shift+Enter — описание"
      :recent="recent"
      @submit="save()"
      @pick="(s) => s.kind && (kind = s.kind)"
    />

    <!-- everything else — one row of equal small square buttons; their choices open as lists (the card never jumps) -->
    <div class="bar tw:flex tw:items-center tw:flex-wrap tw:gap-6">
      <NoteLinks v-if="entry.id" :id="entry.id" />
      <TaskPicker v-if="!readonly" v-model="tasks" :single="!!entry.id" compact square />
      <AttrPicker v-if="!readonly" v-model="attrs" />
      <DictateButton v-if="!readonly" square @recorded="(r) => save(r)" />
      <PopChip v-model:open="remindOpen" square icon="bell" :label="remindShort" :active="remindMode !== 'off'" :title="remindMode === 'off' ? 'Напомнить — уведомление Windows' : `Напоминание: ${remindShort}`">
        <button class="pci" :class="{ cur: remindMode === 'off' }" @click="(remindMode = 'off'), (remindOpen = false)">Не напоминать</button>
        <button v-for="m in REMIND_BEFORE" :key="m" class="pci tw:[&.badge]:text-[10px] tw:[&.badge]:py-2 tw:[&.badge]:px-6 tw:[&.badge]:rounded-r2 tw:[&.badge]:bg-accent tw:[&.bar]:flex tw:[&.bar]:items-center tw:[&.bar]:flex-wrap tw:[&.bar]:gap-6 tw:hover:enabled:bg-hover" :class="{ cur: remindMode === `b${m}` }" @click="(remindMode = `b${m}`), (remindOpen = false)">Напомнить {{ beforeLabel(m) }}</button>
        <div class="pcsep"></div>
        <div class="pcrow">
          <button class="pci" :class="{ cur: remindMode === 'at' }" @click="remindMode = 'at'">В точное время</button>
          <TimeField v-if="remindMode === 'at'" compact :model-value="remindTime" @update:model-value="(v) => (remindTime = v)" />
        </div>
      </PopChip>
      <PopChip
        v-if="!entry.id && !readonly"
        v-model:open="repeatOpen"
        square
        icon="repeat"
        :label="repeatShort"
        :active="!!repeatRule"
        :title="repeatRule ? `Повтор: ${repeatShort}` : 'Повторять'"
      >
        <button class="pci" :class="{ cur: !repeatRule }" @click="(repeatRule = ''), (repeatOpen = false)">Не повторять</button>
        <button v-for="r in REPEAT_RULES" :key="r.id" class="pci" :class="{ cur: repeatRule === r.id }" @click="repeatRule = r.id">{{ r.label }}</button>
        <template v-if="repeatRule">
          <div class="pcsep"></div>
          <div class="pcrow">Сколько раз всего <input v-model.number="repeatCount" type="number" min="2" max="366" /></div>
        </template>
      </PopChip>
    </div>

    <div v-if="tasks.length === 1 && taskTotals[tasks[0].key]" class="spent tw:flex tw:items-center tw:gap-6 tw:-mt-4 tw:text-[12px] tw:text-muted" title="Время по задаче за все дни">
      <Icon name="clock" :size="12" />{{ tasks[0].key }} · всего {{ formatDuration(taskTotals[tasks[0].key]) }}
    </div>
    <div v-if="copied" class="copied tw:flex tw:items-center tw:gap-6 tw:text-[12px] tw:text-accent-fg"><Icon name="link" :size="13" />Продолжение: {{ copied }}</div>
    <div v-if="copiedTo" class="copied tw:flex tw:items-center tw:gap-6 tw:text-[12px] tw:text-accent-fg"><Icon name="copy" :size="13" />Копия создана: {{ copiedTo }}</div>
    <Transition name="fade"><div v-if="error" class="error tw:text-down-fg tw:text-[13px]">{{ error }}</div></Transition>

    <!-- an existing event saves itself — only its state shows; a new one is added by the button -->
    <div v-if="entry.id && manual" class="foot tw:flex tw:items-center tw:gap-10">
      <button class="primary" :disabled="busy" @click="save()">Сохранить</button>
      <button :disabled="busy" @click="emit('close')">Отмена</button>
      <span class="muted small tw:text-[12px]">Ctrl+Enter</span>
    </div>
    <div v-else-if="entry.id" class="foot autos tw:flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12px] tw:[&.saved]:not-[&.saving]:not-[&.pending]:text-up-fg tw:[&.saving]:not-[&.pending]:text-warn-fg tw:[&.pending]:text-warn-fg" :class="saveState">
      <Icon :name="saveState === 'saved' || saveState === 'idle' ? 'check' : 'clock'" :size="12" />
      <span>{{ saveState === 'pending' ? 'Изменено — сохранится, когда уйдёте из карточки' : saveState === 'saving' ? 'Сохраняю…' : saveState === 'saved' ? 'Сохранено' : 'Изменения сохраняются при выходе из карточки' }}</span>
      <button v-if="saveState === 'pending'" class="now tw:ml-auto tw:py-3 tw:px-10 tw:text-[12px]" title="Ctrl+Enter" @click="flush">Сохранить</button>
    </div>
    <div v-else class="foot tw:flex tw:items-center tw:gap-10">
      <button class="primary" :disabled="busy" @click="save()">{{ repeatRule ? `Добавить ${repeatCount} раз` : 'Добавить' }}</button>
      <span class="muted small tw:text-[12px]">Ctrl+Enter</span>
    </div>
  </div>
</template>

<style scoped src="./EntryEditor.css"></style>
