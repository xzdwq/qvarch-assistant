<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { dayStart, MINUTE, shiftDay } from '@shared/timeline'
import { parseQuick, type Quick } from '@shared/quickadd'
import type { TaskRef } from '@shared/jira'
import type { Ms } from '@shared/types'
import { isOwnTask } from '@shared/work'
import { kindColor, kindLabel, kinds } from '../lib/palette'
import { useQuickSuggest } from '../tracker/quick/useQuickSuggest'
import Icon from './Icon.vue'
import Popover from './Popover.vue'
import TaskSearch from './TaskSearch.vue'
import TimeRange from './TimeRange.vue'

/**
 * One line to add anything to the work: a past piece of time or a plan. The text is understood as it is typed
 * (time, duration, task key, #kind, day — see shared/quickadd) and shown under the line before Enter.
 * "@" — pick a task, "#" — pick a kind.
 */
export interface QuickDraft {
  day: string
  start: Ms
  end: Ms
  kind: string
  label: string
  task?: TaskRef
}
const props = defineProps<{
  day: string
  weekStart: string
  /** Where a line without an exact time goes. */
  place: (q: Quick) => { start: Ms; end: Ms }
  /** «Запись» goes on (the button stops it). */
  recording?: boolean
}>()
const emit = defineEmits<{ add: [d: QuickDraft]; record: [r: { kind: string; label: string }]; stopRecord: [] }>()

const text = ref('')
const inp = ref<HTMLInputElement>()
const focused = ref(false)
const attached = ref<TaskRef>()
const KIND_KEY = 'qa.quickKind'
const kindSel = ref(readKind())
function readKind(): string {
  try {
    return localStorage.getItem(KIND_KEY) || 'task'
  } catch {
    return 'task'
  }
}
watch(kindSel, (v) => {
  try {
    localStorage.setItem(KIND_KEY, v)
  } catch {
    // fine
  }
})
const shownKinds = computed(() => kinds.value.filter((k) => !k.hidden))

/** «@» task / «#» kind suggestions: a picked one becomes a chip (the kind / the task). */
const { summaryOf, sug, active, sugOpen, updateSug, pickSug, onSugKey } = useQuickSuggest({
  text: () => text.value,
  setText: (t) => (text.value = t),
  field: () => inp.value,
  kinds: () => shownKinds.value,
  blanks: /\s{2,}/g,
  onPick: (type, it) => (type === '#' ? (kindSel.value = it.id) : (attached.value = { key: it.id, summary: it.sub ?? '' })),
})

const q = computed(() => parseQuick(text.value, { day: props.day, weekStart: props.weekStart, kinds: kinds.value }))
const task = computed<TaskRef | undefined>(() => attached.value ?? (q.value.task ? { key: q.value.task, summary: summaryOf(q.value.task) } : undefined))
const kind = computed(() => q.value.kind ?? (task.value && !attached.value ? 'task' : kindSel.value))
// ---------- the day and the time under the line: the wheel / the keys change them ----------
/** Set by hand in the preview (they win over the text until the text names another time / day). */
const dayOv = ref<string>()
const startOv = ref<number>()
const endOv = ref<number>()
watch(
  // a string: a new array every keystroke would reset the hand-set time while the title is typed
  () => [q.value.day, q.value.start, q.value.end, q.value.dur].join('|'),
  () => {
    dayOv.value = undefined
    startOv.value = undefined
    endOv.value = undefined
  },
)
const finalDay = computed(() => dayOv.value ?? q.value.day)
const range = computed(() => {
  const r = props.place(q.value)
  const base = dayStart(finalDay.value)
  const shift = base - dayStart(q.value.day)
  let start = r.start + shift
  let end = r.end + shift
  if (startOv.value !== undefined) start = base + startOv.value * MINUTE
  if (endOv.value !== undefined) end = base + endOv.value * MINUTE
  if (end <= start) end = start + Math.max(5 * MINUTE, r.end - r.start)
  return { start, end }
})
const handTime = computed(() => startOv.value !== undefined || endOv.value !== undefined)
const minOf = (t: number) => Math.round((t - dayStart(finalDay.value)) / MINUTE)
/** The wheel: up — later (the next day), down — earlier. */
const dirOf = (e: WheelEvent) => ((Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0 ? 1 : -1)
function wheelDay(e: WheelEvent): void {
  e.preventDefault()
  dayOv.value = shiftDay(finalDay.value, dirOf(e))
}
/** The arrows on the day chip: up / right — the next day, down / left — the day before. */
const DAY_KEYS: Partial<Record<string, 1 | -1>> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }
function keyDay(e: KeyboardEvent): void {
  const d = DAY_KEYS[e.key]
  if (!d) return
  e.preventDefault()
  dayOv.value = shiftDay(finalDay.value, d)
}
/** The time set by hand in the preview (TimeRange keeps the start before the end). */
function setRange(r: { start: number; end: number }): void {
  startOv.value = minOf(r.start)
  endOv.value = minOf(r.end)
}
const label = computed(() => q.value.label || (task.value ? `${task.value.key} ${task.value.summary}`.trim() : kindLabel(kind.value)))
const ready = computed(() => !!(q.value.label || task.value || q.value.kind || q.value.parts.length))
const otherDay = computed(() => finalDay.value !== props.day)
const dayText = (d: string) => {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function submit(): void {
  if (!ready.value) return
  const r = range.value
  emit('add', { day: finalDay.value, start: r.start, end: r.end, kind: kind.value, label: label.value, task: task.value })
  dayOv.value = undefined
  startOv.value = undefined
  endOv.value = undefined
  text.value = ''
  attached.value = undefined
  sug.value = undefined
}

/** «Запись»: begun with the line's kind and text (the line cleared) — or stopped. */
function toggleRecord(): void {
  if (props.recording) return emit('stopRecord')
  emit('record', { kind: kind.value, label: label.value })
  text.value = ''
  attached.value = undefined
}

// ---------- the line's keys (the «@» / «#» list first, while it is open) ----------
const fieldEl = ref<HTMLElement>()
/** Enter adds; Esc clears the line, an empty one is left. */
const LINE_KEYS: Partial<Record<string, (e: KeyboardEvent) => void>> = {
  Enter: (e) => {
    e.preventDefault()
    submit()
  },
  Escape: (e) => {
    e.stopPropagation()
    if (text.value || attached.value) {
      text.value = ''
      attached.value = undefined
    } else inp.value?.blur()
  },
}
function onKey(e: KeyboardEvent): void {
  if (!onSugKey(e)) LINE_KEYS[e.key]?.(e)
}

/** Put a text in (a free gap was clicked) and focus — or just focus. */
function focus(prefill?: string): void {
  if (prefill !== undefined) text.value = prefill
  void nextTick(() => {
    inp.value?.focus()
    const n = text.value.length
    inp.value?.setSelectionRange(n, n)
  })
}
defineExpose({ focus })
</script>

<template>
  <div class="qa tw:group/qa tw:border tw:border-border-2 tw:rounded-r3 tw:bg-panel tw:[transition:border-color_0.12s] tw:[&.focused]:border-accent-line tw:[&.focused]:[box-shadow:0_0_0_3px_var(--accent-soft)]" :class="{ focused }">
    <div class="qrow tw:flex tw:items-center tw:gap-8 tw:pt-8 tw:pr-8 tw:pb-6 tw:pl-8">
      <span class="qkinds tw:inline-flex tw:flex-none tw:gap-2">
        <button v-for="k in shownKinds" :key="k.id" class="qk tw:inline-flex tw:items-center tw:justify-center tw:w-30 tw:h-30 tw:p-0 tw:border tw:border-transparent tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:not-[&.on]:text-(--c) tw:[&.on]:border-(--c) tw:[&.on]:bg-[color-mix(in_srgb,var(--c)_18%,transparent)] tw:[&.on]:text-(--c) tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: kind === k.id }" :style="{ '--c': k.color }" :title="k.label" @click="kindSel = k.id">
          <Icon :name="k.icon" :size="14" />
        </button>
      </span>
      <div ref="fieldEl" class="qfield tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:gap-8 tw:h-34 tw:py-0 tw:px-10 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:group-[.focused]/qa:border-accent">
        <Icon name="plus" :size="14" class="qplus tw:[&&]:flex-none tw:text-accent-fg" />
        <span v-if="attached" class="qchip tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:h-22 tw:pt-0 tw:pr-2 tw:pb-0 tw:pl-7 tw:rounded-r2 tw:bg-info/16 tw:text-info-fg tw:font-data tw:text-[11.5px]" :title="attached.summary">
          <Icon :name="isOwnTask(attached.key) ? 'checkSquare' : 'jira'" :size="11" />{{ attached.key }}
          <button class="tw:inline-flex tw:p-3 tw:border-0 tw:bg-transparent tw:text-inherit" title="Убрать задачу" @click="attached = undefined"><Icon name="x" :size="10" /></button>
        </span>
        <input class="tw:flex-1 tw:min-w-0 tw:h-full tw:p-0 tw:border-0 tw:bg-transparent tw:text-[13.5px]"
          ref="inp"
          v-model="text"
          spellcheck="false"
          placeholder="Что сделано или в планах — время, ABC-123, #вид, завтра…"
          @keydown="onKey"
          @input="updateSug"
          @click="updateSug"
          @focus="focused = true"
          @blur="(focused = false), (sug = undefined)"
        />
        <kbd class="tw:flex-none tw:py-0 tw:px-5 tw:border tw:border-border-2 tw:rounded-r1 tw:text-dim tw:font-data tw:text-[10.5px]" v-if="!focused && !text">N</kbd>
      </div>
      <TaskSearch :marked="attached ? [attached.key] : []" placeholder="Задача для этой записи" @pick="(t) => (attached = t)">
        <button class="qb tw:inline-flex tw:items-center tw:justify-center tw:w-34 tw:h-34 tw:p-0 tw:text-text-2" title="Задача Jira или своя"><Icon name="jira" :size="14" /></button>
      </TaskSearch>
      <button class="qb qrec tw:inline-flex tw:items-center tw:justify-center tw:w-34 tw:h-34 tw:p-0 tw:text-text-2 tw:[&.on]:border-down tw:[&.on]:bg-down/16 tw:[&.on]:text-down-fg" :class="{ on: recording }" :title="recording ? 'Остановить запись' : `Запись: событие «${kindLabel(kind)}» начнётся сейчас и будет идти, пока не остановите (продлевается само; в конце рабочего дня останавливается — см. «Рабочий график»)`" @mousedown.prevent @click="toggleRecord"><Icon :name="recording ? 'stop' : 'rec'" :size="14" /></button>
      <button class="primary qgo tw:h-34 tw:py-0 tw:px-14" :disabled="!ready" @mousedown.prevent @click="submit">Добавить</button>
    </div>
    <div class="qprev tw:flex tw:items-center tw:gap-8 tw:min-h-28 tw:pt-0 tw:pr-10 tw:pb-7 tw:pl-10 tw:overflow-hidden tw:whitespace-nowrap tw:text-[12px]">
      <template v-if="ready">
        <span class="pv day tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-20 tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2 tw:[&.other]:bg-accent-soft tw:[&.other]:text-accent-fg tw:cursor-ns-resize tw:hover:not-focus:[outline:1px_solid_var(--accent-line)] tw:focus:[outline:1px_solid_var(--accent-line)]" :class="{ other: otherDay }" tabindex="0" title="Колесо или стрелки — другой день" @wheel="wheelDay" @keydown="keyDay"><Icon name="calendar" :size="11" />{{ dayText(finalDay) }}</span>
        <span class="pv time tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-20 tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-panel-3 tw:font-data tw:text-text" :class="{ auto: q.start === undefined && !handTime }" :title="q.start === undefined && !handTime ? 'Время не указано — сейчас + 30 мин' : ''">
          <TimeRange :start="range.start" :end="range.end" @change="setRange"><i class="tw:text-muted tw:not-italic" v-if="q.start === undefined && !handTime"> авто</i></TimeRange>
        </span>
        <span class="pv kind tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-20 tw:py-0 tw:px-7 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2" :style="{ '--c': kindColor(kind) }"><i class="tw:w-8 tw:h-8 tw:rounded-[2px] tw:[background:var(--c)]"></i>{{ kindLabel(kind) }}</span>
        <span v-if="task" class="pv task tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-20 tw:py-0 tw:px-7 tw:rounded-r2 tw:max-w-340 tw:bg-info/14 tw:text-info-fg tw:font-data tw:[&.unknown]:bg-warn/14 tw:[&.unknown]:text-warn-fg" :class="{ unknown: !task.summary }" :title="task.summary || 'Задача не найдена в списке'">
          <Icon :name="isOwnTask(task.key) ? 'checkSquare' : 'jira'" :size="11" />{{ task.key }}<span v-if="task.summary" class="ts tw:overflow-hidden tw:text-ellipsis tw:font-ui tw:text-text-2">{{ task.summary }}</span>
        </span>
        <span class="pv lbl tw:inline-flex tw:items-center tw:gap-5 tw:h-20 tw:py-0 tw:px-7 tw:rounded-r2 tw:flex-[0_1_auto] tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:bg-transparent tw:text-text">«{{ label }}»</span>
        <span class="grow tw:flex-1"></span>
        <span class="enter tw:flex-none tw:text-dim tw:font-data tw:text-[10.5px]">Enter ⏎</span>
      </template>
      <span v-else class="hint tw:text-dim tw:overflow-hidden tw:text-ellipsis">«ревью ABC-123 14:00-15:00» · «созвон 30м #созвон» · «завтра 10:00 демо» · <b class="tw:text-accent-fg tw:font-data">@</b> задача · <b class="tw:text-accent-fg tw:font-data">#</b> вид</span>
    </div>
    <Popover v-model:open="sugOpen" :anchor="fieldEl" :width="420" align-left :chrome="0" max-height="none" :esc="false" class="qa-sug tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" @mousedown.prevent>
        <button v-for="(it, i) in sug!.items" :key="it.id" class="qs tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:[&.on]:bg-accent-soft tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:border-border-3" :class="{ on: i === active }" @mouseenter="active = i" @click="pickSug(i)">
          <Icon :name="it.icon" :size="13" :style="it.color ? { color: it.color } : {}" />
          <b class="tw:flex-none tw:font-data tw:text-[12px] tw:font-semibold">{{ it.title }}</b>
          <span v-if="it.sub" class="qss tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2">{{ it.sub }}</span>
        </button>
    </Popover>
  </div>
</template>

<style scoped src="./QuickAdd.css"></style>
