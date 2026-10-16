<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dayEnd, formatDuration, joinTitle, MINUTE, splitTitle } from '@shared/timeline'
import type { Entry, EntryKind, Ms, Note } from '@shared/types'
import { VOICE_PENDING } from '@shared/voice'
import { kindLabel, kinds } from '../lib/palette'
import { saveRecording } from '../lib/recorder'
import LabelInput, { type Recent } from './LabelInput.vue'
import TaskPicker from './TaskPicker.vue'
import DictateButton from './DictateButton.vue'
import { plainTask, type TaskRef } from '@shared/jira'
import Icon from './Icon.vue'
import TimeField from './TimeField.vue'
import OffsetField from './OffsetField.vue'
import PopChip from './PopChip.vue'
import { beforeLabel, REMIND_BEFORE, REPEAT_RULES, type Remind, type RepeatRule } from '@shared/repeat'
import { askSeries } from '../lib/seriesAsk'
import QuickField, { type QuickParsed } from './QuickField.vue'
import { dayStart } from '@shared/timeline'

/** followsNow — the end is "now" (N minutes back); startsNow — the start is "now" (N minutes ahead). */
export type Draft = Omit<Entry, 'id'> & { id?: string; followsNow?: boolean; startsNow?: boolean }
/** How a new block without a picked range is placed: from now / the cursor, forward or back, N minutes. */
export interface AddPrefs {
  from: 'now' | 'cursor'
  back: boolean
  min: number
}

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
}>()
const emit = defineEmits<{
  saved: [e: Entry]
  deleted: []
  close: []
  /** Draft times changed in the form → move the marker on the timeline. */
  range: [r: { start: Ms; end: Ms; followsNow: boolean }]
  'update:add': [a: AddPrefs]
}>()

const start = ref(0)
const end = ref(0)
const followsNow = ref(false)
const startsNow = ref(false)
const label = ref('')
const kind = ref<EntryKind>('task')
/** The Jira task this time goes to. */
const tasks = ref<TaskRef[]>([])
const error = ref('')
const busy = ref(false)
const labelInput = ref<InstanceType<typeof LabelInput>>()
const quickEl = ref<InstanceType<typeof QuickField>>()
/** What the quick line of a new event says (time, duration, day, kind, task). */
const parsed = ref<QuickParsed>()
const isNew = computed(() => !props.entry.id && !props.entry.outlook)
watch(() => parsed.value?.q.kind, (k) => k && isNew.value && (kind.value = k))
/** A task picked with «@» joins the event's tasks. */
function addTask(t: TaskRef): void {
  if (!tasks.value.some((x) => x.key === t.key)) tasks.value = [...tasks.value, t]
}
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
const copied = ref('')
/** An Outlook meeting is Outlook's: only a reminder can be set here. */
const readonly = computed(() => !!props.entry.outlook)

// ---------- a reminder ----------
/** off · b<N> — N minutes before the start (follows the block) · at — a set time */
const remindMode = ref('off')
const remindTime = ref(0)
const remind = computed<Remind | undefined>(() =>
  remindMode.value === 'off' ? undefined : remindMode.value === 'at' ? { at: remindTime.value } : { before: Number(remindMode.value.slice(1)) },
)
function initRemind(): void {
  const r = props.entry.remind
  remindMode.value = !r ? 'off' : r.at !== undefined ? 'at' : `b${r.before ?? 0}`
  remindTime.value = r?.at ?? props.entry.start
}
watch(remindMode, (m) => {
  if (m === 'at' && !remindTime.value) remindTime.value = start.value
})

// ---------- a repeat (a new block) ----------
const repeatRule = ref<RepeatRule | ''>('')
const repeatCount = ref(10)
watch(repeatRule, (r) => r && (repeatCount.value = REPEAT_RULES.find((x) => x.id === r)!.count))
const remindOpen = ref(false)
const repeatOpen = ref(false)
/** Short labels of the chips. */
const remindShort = computed(() => {
  const m = remindMode.value
  if (m === 'off') return ''
  if (m === 'at') return new Date(remindTime.value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const n = Number(m.slice(1))
  return n === 0 ? 'в начале' : n < 60 ? `за ${n}м` : `за ${n / 60}ч`
})
const REPEAT_SHORT: Record<RepeatRule, string> = { hour: 'час', day: 'день', week: 'нед', year: 'год' }
const repeatShort = computed(() => (repeatRule.value ? `${REPEAT_SHORT[repeatRule.value]} ×${repeatCount.value}` : ''))
const seriesText = computed(() => {
  const s = props.entry.series
  return s ? (REPEAT_RULES.find((x) => x.id === s.rule)?.every ?? '') : ''
})

function setAdd(p: Partial<AddPrefs>): void {
  if (props.add) emit('update:add', { ...props.add, ...p })
}

// identity of the thing being edited: re-init the text fields only when it changes
const identity = computed(() => props.entry.id ?? 'draft')
watch(
  identity,
  () => {
    label.value = joinTitle(props.entry.label, props.entry.description)
    tasks.value = props.entry.task ? [props.entry.task] : []
    kind.value = props.entry.kind
    error.value = ''
    copied.value = ''
    initRemind()
    repeatRule.value = ''
  },
  { immediate: true },
)
// times follow the entry/marker live (marker drags on the timeline)
watch(
  () => [props.entry.start, props.entry.end, props.entry.followsNow, props.entry.startsNow] as const,
  ([s, e, f, n]) => {
    start.value = s
    end.value = e
    followsNow.value = !!f
    startsNow.value = !!n
  },
  { immediate: true },
)

const effectiveEnd = computed(() => (followsNow.value && props.now ? props.now : end.value))

function pushRange(): void {
  if (props.entry.id) return
  emit('range', { start: start.value, end: effectiveEnd.value, followsNow: followsNow.value })
}
function setStart(t: Ms): void {
  startsNow.value = false
  start.value = Math.min(t, effectiveEnd.value - MINUTE)
  pushRange()
}
function setEnd(t: Ms): void {
  followsNow.value = false
  end.value = Math.max(t, start.value + MINUTE)
  pushRange()
}

type Dictation = { blob: Blob; durationSec: number; at: number; kind: 'voice' | 'call' }
async function save(dict?: Dictation): Promise<void> {
  error.value = ''
  const endT = effectiveEnd.value
  if (!(endT > start.value)) {
    error.value = 'Конец должен быть позже начала'
    return
  }
  busy.value = true
  try {
    // an Outlook meeting: only its reminder
    if (readonly.value && props.entry.id) {
      await window.qa.setRemind(props.day, props.entry.id, remind.value ?? null)
      emit('saved', { ...(props.entry as Entry), remind: remind.value })
      return
    }
    // one of a series: this one, or all of them
    if (props.entry.id && props.entry.series) {
      const scope = await askSeries('save')
      if (!scope) return
      if (scope === 'all') {
        const parts = splitTitle(label.value)
        const t = tasks.value[0] ? plainTask(tasks.value[0]) : undefined
        const next: Entry = {
          ...(props.entry as Entry),
          start: start.value,
          end: endT,
          label: parts.label || (t ? `${t.key} ${t.summary}` : kindLabel(kind.value)),
          description: parts.description,
          task: t,
          kind: kind.value,
          remind: remind.value,
        }
        await window.qa.seriesSave(props.day, next)
        emit('saved', next)
        return
      }
    }
    const { followsNow: _f, startsNow: _n, ...base } = props.entry
    // a new event: what its quick line says wins over the form (time, duration, day, task; the title is the rest)
    let day = props.day
    let s0 = start.value
    let e0 = endT
    let title = splitTitle(label.value).label
    const qp = isNew.value ? parsed.value : undefined
    const taskList = [...tasks.value]
    if (qp) {
      const q = qp.q
      title = q.label
      if (q.start !== undefined) {
        s0 = q.start
        e0 = q.end ?? q.start + (q.dur ?? endT - start.value)
        day = q.day
      } else {
        if (q.dur) {
          if (followsNow.value) s0 = e0 - q.dur
          else e0 = s0 + q.dur
        }
        if (q.day !== props.day) {
          const shift = dayStart(q.day) - dayStart(props.day)
          s0 += shift
          e0 += shift
          day = q.day
        }
      }
      if (qp.task && !taskList.some((x) => x.key === qp.task!.key)) taskList.push(qp.task)
      if (!(e0 > s0)) {
        error.value = 'Конец должен быть позже начала'
        return
      }
    }
    // a new block linked to several tasks → one parallel block per task
    const targets: Array<TaskRef | undefined> = taskList.length ? taskList.map(plainTask) : [undefined]
    let saved: Entry | undefined
    for (const [n, t] of targets.entries()) {
      const r = await window.qa.saveEntry(day, {
        ...base,
        start: s0,
        end: e0,
        // a meeting or a break needs no description — the kind itself (or the linked task) is the label;
        // dictated: a placeholder until the transcript fills it
        label: title || (dict ? VOICE_PENDING : t ? `${t.key} ${t.summary}` : kindLabel(kind.value)),
        description: splitTitle(label.value).description,
        task: t,
        kind: kind.value,
        source: props.entry.id ? props.entry.source : 'manual',
        remind: remind.value,
        // only the first one replaces the edited block; the rest are new
        ...(n > 0 ? { id: undefined, lane: undefined, series: undefined } : {}),
      }, { overlap: true })
      saved ??= r
    }
    // the dictation is kept as an audio note of the block; its transcript fills the block's text
    if (dict && saved) void saveRecording(day, { ...dict, at: s0 }, { entryId: saved.id })
    // a new block with a repeat: its copies every hour / day / week / year
    if (saved && !props.entry.id && repeatRule.value) await window.qa.repeatEntry(day, saved.id, repeatRule.value, repeatCount.value)
    if (saved) emit('saved', saved)
  } catch (e) {
    error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  if (!props.entry.id) return emit('close')
  if (props.entry.series) {
    const scope = await askSeries('delete')
    if (!scope) return
    if (scope === 'all') {
      await window.qa.seriesDelete(props.day, props.entry.id)
      return emit('deleted')
    }
  }
  await window.qa.deleteEntry(props.day, props.entry.id)
  emit('deleted')
}
const shown = computed(() => kinds.value.filter((x) => !x.hidden || x.id === kind.value))
const openJoin = (url: string) => window.qa.openExternal(url)
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
  <div class="editor" @keydown.ctrl.enter="save()">
    <div class="head">
      <h3>{{ entry.id ? 'Событие' : 'Новое событие' }}</h3>
      <span v-if="entry.source === 'ai'" class="badge">AI</span>
      <span v-if="entry.outlook" class="badge ol" :title="entry.outlook.organizer ? `Из Outlook · организатор ${entry.outlook.organizer}` : 'Из Outlook'">Outlook</span>
      <button v-if="entry.outlook?.joinUrl && (now ?? 0) < entry.end" class="join" title="Подключиться к встрече в Teams" @click="openJoin(entry.outlook.joinUrl)"><Icon name="users" :size="13" />Teams</button>
      <span class="spacer"></span>
      <span v-if="entry.series" class="badge rep" :title="`Повторяется ${seriesText} — изменения можно применить ко всей серии`"><Icon name="repeat" :size="11" />{{ seriesText }}</span>
      <button v-if="entry.id && !readonly" class="hbtn danger" title="Удалить событие" @click="remove"><Icon name="trash" :size="15" /></button>
      <!-- a new block's form is always there — nothing to close -->
      <button v-if="entry.id" class="hbtn" title="Закрыть (Esc)" @click="emit('close')"><Icon name="x" :size="16" /></button>
    </div>
    <div v-if="readonly" class="ro"><Icon name="outlook" :size="13" />Встреча из Outlook — время, название и вид меняет только Outlook. Здесь — напоминание.</div>

    <!-- the host may put the date here (the task calendar) -->
    <slot name="date" />
    <!-- when: one line; for a new block — quiet presets right under it -->
    <div v-if="readonly" class="when">
      <b class="rot">{{ new Date(start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }} – {{ new Date(effectiveEnd).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }}</b>
      <span class="dur">{{ formatDuration(effectiveEnd - start) }}</span>
    </div>
    <div v-else class="when">
      <TimeField :model-value="start" :live="startsNow" :max="effectiveEnd - 60000" @update:model-value="setStart" />
      <span class="dash">–</span>
      <TimeField :model-value="effectiveEnd" :live="followsNow" :min="start + 60000" :max="dayEnd(day)" @update:model-value="setEnd" />
      <span class="dur">{{ formatDuration(effectiveEnd - start) }}</span>
    </div>
    <div v-if="add && !readonly" class="presets">
      <button
        class="pill"
        :title="add.from === 'now' ? 'От текущего момента' : 'От курсора на таймлайне'"
        :disabled="!hasCursor && add.from === 'now'"
        @click="setAdd({ from: add.from === 'now' ? 'cursor' : 'now' })"
      >
        <Icon :name="add.from === 'now' ? 'clock' : 'pin'" :size="12" />{{ add.from === 'now' ? (now ? 'сейчас' : '09:00') : 'курсор' }}
      </button>
      <OffsetField :model-value="add.back ? -add.min : add.min" @update:model-value="(v) => setAdd({ back: v < 0, min: Math.abs(v) })" />
    </div>

    <!-- the kind first, right above the text -->
    <div v-if="!readonly" class="kinds" role="radiogroup" aria-label="Вид занятости">
      <button
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

    <div v-if="readonly" class="rotitle">{{ entry.label }}<span v-if="entry.description" class="muted">{{ entry.description }}</span></div>
    <QuickField
      v-else-if="isNew"
      ref="quickEl"
      v-model="label"
      :day="day"
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
      class="ta"
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

    <!-- everything else — one row of equal chips; their choices open as lists (the card never jumps) -->
    <div class="bar">
      <TaskPicker v-if="!readonly" v-model="tasks" :single="!!entry.id" compact />
      <DictateButton v-if="!readonly" compact @recorded="(r) => save(r)" />
      <PopChip v-model:open="remindOpen" icon="bell" :label="remindShort" :active="remindMode !== 'off'" :title="remindMode === 'off' ? 'Напомнить — уведомление Windows' : `Напоминание: ${remindShort}`">
        <button class="pci" :class="{ cur: remindMode === 'off' }" @click="(remindMode = 'off'), (remindOpen = false)">Не напоминать</button>
        <button v-for="m in REMIND_BEFORE" :key="m" class="pci" :class="{ cur: remindMode === `b${m}` }" @click="(remindMode = `b${m}`), (remindOpen = false)">Напомнить {{ beforeLabel(m) }}</button>
        <div class="pcsep"></div>
        <div class="pcrow">
          <button class="pci" :class="{ cur: remindMode === 'at' }" @click="remindMode = 'at'">В точное время</button>
          <TimeField v-if="remindMode === 'at'" compact :model-value="remindTime" @update:model-value="(v) => (remindTime = v)" />
        </div>
      </PopChip>
      <PopChip
        v-if="!entry.id && !readonly"
        v-model:open="repeatOpen"
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

    <div v-if="tasks.length === 1 && taskTotals[tasks[0].key]" class="spent" title="Время по задаче за все дни">
      <Icon name="clock" :size="12" />{{ tasks[0].key }} · всего {{ formatDuration(taskTotals[tasks[0].key]) }}
    </div>
    <div v-if="copied" class="copied"><Icon name="link" :size="13" />Продолжение: {{ copied }}</div>
    <Transition name="fade"><div v-if="error" class="error">{{ error }}</div></Transition>

    <div class="foot">
      <button class="primary" :disabled="busy" @click="save()">{{ entry.id ? 'Сохранить' : repeatRule ? `Добавить ${repeatCount} раз` : 'Добавить' }}</button>
      <span class="muted small">Ctrl+Enter</span>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.head {
  display: flex;
  align-items: center;
  gap: 4px;
}
h3 {
  margin: 0;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--r2);
  background: var(--accent);
}
.spacer {
  flex: 1;
}
.badge.ol {
  background: var(--info);
}
.badge.rep {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--accent-fg);
}
.ro {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: -4px;
  padding: 6px 9px;
  border-radius: 4px;
  background: rgba(68, 138, 255, 0.14);
  color: var(--info-fg);
  font-size: 12px;
}
.rot {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  font-size: 15px;
}
.rotitle {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  font-weight: 600;
}
.rotitle .muted {
  font-size: 12px;
  font-weight: 400;
  white-space: pre-wrap;
}
.join {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--r2);
  font-size: 12px;
  color: var(--accent-fg);
}
.hbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.hbtn:hover {
  background: var(--hover);
  color: var(--text);
}
.hbtn.danger:hover {
  color: var(--down-fg);
}
.when {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dash {
  color: var(--muted);
}
.dur {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.small {
  font-size: 12px;
}
/* quiet presets: plain text until hovered / picked */
.presets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: -4px;
}
.presets button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.presets button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.presets .pill {
  color: var(--accent-fg);
}
.presets .dbtn.on {
  background: rgb(var(--accent-rgb) / 0.22);
  color: var(--text-hi);
}
.presets .sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--border);
}
.field {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.field > :first-child {
  flex: 1;
  min-width: 0;
}
.ta {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  max-height: 420px;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
  outline: none;
}
.ta:focus {
  border-color: var(--accent);
}
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.kinds button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--kc, var(--muted));
  font-size: 12px;
  transition:
    background 0.15s,
    color 0.15s;
}
.kinds button:hover:not(.on) {
  background: var(--hover);
}
.kinds button.on {
  color: var(--text-hi);
  font-weight: 600;
}
/* one row of equal chips (task, links, voice, reminder, repeat) */
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.bar :deep(.chip),
.bar :deep(.dict) {
  height: 32px;
  min-width: 32px;
  padding: 0 10px;
  font-size: 12.5px;
}
.bar :deep(.dict) {
  padding: 0;
  width: 32px;
  border-radius: 4px;
}
.bar :deep(.dict.on) {
  width: auto;
  padding: 0 10px;
}
.spent {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: -4px;
  font-size: 12px;
  color: var(--muted);
}
.copied {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent-fg);
}
.error {
  color: var(--down-fg);
  font-size: 13px;
}
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
