<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { dayStart, MINUTE, shiftDay } from '@shared/timeline'
import { parseQuick, type Quick } from '@shared/quickadd'
import { pickableTasks, type TaskRef } from '@shared/jira'
import type { Ms } from '@shared/types'
import { kindColor, kindLabel, kinds } from '../lib/palette'
import { useJira } from '../lib/jira'
import { useLocalTasks } from '../lib/tasks'
import { placeFloat, useAnchor } from '../lib/floating'
import Icon from './Icon.vue'
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
}>()
const emit = defineEmits<{ add: [d: QuickDraft] }>()

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

const jira = useJira()
const own = useLocalTasks()
/** Every task that can be named: own (open) and mine / starred in Jira. */
const allTasks = computed<Array<TaskRef & { own: boolean }>>(() => [
  ...own.value.filter((t) => t.key && t.status !== 'done').map((t) => ({ key: t.key!, summary: t.title, own: true })),
  ...pickableTasks(jira.value).map((i) => ({ key: i.key, summary: i.summary, own: false })),
])
const summaryOf = (key: string) => allTasks.value.find((t) => t.key === key)?.summary ?? jira.value.issues.find((i) => i.key === key)?.summary ?? ''

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
function keyDay(e: KeyboardEvent): void {
  const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
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

// ---------- "@" task / "#" kind suggestions ----------
type Sug = { type: '@' | '#'; from: number; items: Array<{ id: string; title: string; sub?: string; color?: string; icon: string }> }
const sug = ref<Sug>()
const active = ref(0)
const fieldEl = ref<HTMLElement>()
const sugStyle = ref<Record<string, string>>({})
const sugOpen = computed(() => !!sug.value?.items.length)
useAnchor(sugOpen, fieldEl, () => fieldEl.value && (sugStyle.value = placeFloat(fieldEl.value, 420, true, 0).style))
function updateSug(): void {
  const el = inp.value
  if (!el) return
  const before = text.value.slice(0, el.selectionStart ?? text.value.length)
  const m = before.match(/(^|\s)([@#])([^\s]*)$/)
  if (!m) return void (sug.value = undefined)
  const s = m[3].toLowerCase()
  const from = before.length - m[2].length - m[3].length
  const items =
    m[2] === '#'
      ? shownKinds.value.filter((k) => k.label.toLowerCase().includes(s)).map((k) => ({ id: k.id, title: k.label, color: k.color, icon: k.icon }))
      : allTasks.value
          .filter((t) => t.key.toLowerCase().includes(s) || t.summary.toLowerCase().includes(s))
          .slice(0, 8)
          .map((t) => ({ id: t.key, title: t.key, sub: t.summary, icon: t.own ? 'checkSquare' : 'jira' }))
  sug.value = { type: m[2] as '@' | '#', from, items }
  active.value = 0
}
/** A picked suggestion becomes a chip (the kind / the task) — its "@…" / "#…" leaves the text. */
function pickSug(i: number): void {
  const s = sug.value
  const it = s?.items[i]
  if (!s || !it || !inp.value) return
  const caret = inp.value.selectionStart ?? text.value.length
  text.value = `${text.value.slice(0, s.from)}${text.value.slice(caret)}`.replace(/\s{2,}/g, ' ')
  if (s.type === '#') kindSel.value = it.id
  else attached.value = { key: it.id, summary: it.sub ?? '' }
  sug.value = undefined
  void nextTick(() => {
    inp.value?.focus()
    inp.value?.setSelectionRange(s.from, s.from)
  })
}
function onKey(e: KeyboardEvent): void {
  if (sugOpen.value) {
    const n = sug.value!.items.length
    if (e.key === 'ArrowDown') return void (e.preventDefault(), (active.value = (active.value + 1) % n))
    if (e.key === 'ArrowUp') return void (e.preventDefault(), (active.value = (active.value + n - 1) % n))
    if (e.key === 'Enter' || e.key === 'Tab') return void (e.preventDefault(), pickSug(active.value))
    if (e.key === 'Escape') return void (e.stopPropagation(), (sug.value = undefined))
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  } else if (e.key === 'Escape') {
    e.stopPropagation()
    if (text.value || attached.value) {
      text.value = ''
      attached.value = undefined
    } else inp.value?.blur()
  }
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
  <div class="qa" :class="{ focused }">
    <div class="qrow">
      <span class="qkinds">
        <button v-for="k in shownKinds" :key="k.id" class="qk" :class="{ on: kind === k.id }" :style="{ '--c': k.color }" :title="k.label" @click="kindSel = k.id">
          <Icon :name="k.icon" :size="14" />
        </button>
      </span>
      <div ref="fieldEl" class="qfield">
        <Icon name="plus" :size="14" class="qplus" />
        <span v-if="attached" class="qchip" :title="attached.summary">
          <Icon :name="attached.key.startsWith('Q-') ? 'checkSquare' : 'jira'" :size="11" />{{ attached.key }}
          <button title="Убрать задачу" @click="attached = undefined"><Icon name="x" :size="10" /></button>
        </span>
        <input
          ref="inp"
          v-model="text"
          spellcheck="false"
          placeholder="Что сделано или в планах — время, DOS-123, #вид, завтра…"
          @keydown="onKey"
          @input="updateSug"
          @click="updateSug"
          @focus="focused = true"
          @blur="(focused = false), (sug = undefined)"
        />
        <kbd v-if="!focused && !text">N</kbd>
      </div>
      <TaskSearch :marked="attached ? [attached.key] : []" placeholder="Задача для этой записи" @pick="(t) => (attached = t)">
        <button class="qb" title="Задача Jira или своя"><Icon name="jira" :size="14" /></button>
      </TaskSearch>
      <button class="primary qgo" :disabled="!ready" @mousedown.prevent @click="submit">Добавить</button>
    </div>
    <div class="qprev">
      <template v-if="ready">
        <span class="pv day" :class="{ other: otherDay }" tabindex="0" title="Колесо или стрелки — другой день" @wheel="wheelDay" @keydown="keyDay"><Icon name="calendar" :size="11" />{{ dayText(finalDay) }}</span>
        <span class="pv time" :class="{ auto: q.start === undefined && !handTime }" :title="q.start === undefined && !handTime ? 'Время не указано — сейчас + 30 мин' : ''">
          <TimeRange :start="range.start" :end="range.end" @change="setRange"><i v-if="q.start === undefined && !handTime"> авто</i></TimeRange>
        </span>
        <span class="pv kind" :style="{ '--c': kindColor(kind) }"><i></i>{{ kindLabel(kind) }}</span>
        <span v-if="task" class="pv task" :class="{ unknown: !task.summary }" :title="task.summary || 'Задача не найдена в списке'">
          <Icon :name="task.key.startsWith('Q-') ? 'checkSquare' : 'jira'" :size="11" />{{ task.key }}<span v-if="task.summary" class="ts">{{ task.summary }}</span>
        </span>
        <span class="pv lbl">«{{ label }}»</span>
        <span class="grow"></span>
        <span class="enter">Enter ⏎</span>
      </template>
      <span v-else class="hint">«ревью DOS-123 14:00-15:00» · «созвон 30м #созвон» · «завтра 10:00 демо» · <b>@</b> задача · <b>#</b> вид</span>
    </div>
    <Teleport to="body">
      <div v-if="sugOpen" class="qa-sug" :style="sugStyle" @mousedown.prevent>
        <button v-for="(it, i) in sug!.items" :key="it.id" class="qs" :class="{ on: i === active }" @mouseenter="active = i" @click="pickSug(i)">
          <Icon :name="it.icon" :size="13" :style="it.color ? { color: it.color } : {}" />
          <b>{{ it.title }}</b>
          <span v-if="it.sub" class="qss">{{ it.sub }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.qa {
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--panel);
  transition: border-color 0.12s;
}
.qa.focused {
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.qrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 6px;
}
.qkinds {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
.qk {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.qk:hover {
  color: var(--c);
}
.qk.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 18%, transparent);
  color: var(--c);
}
.qfield {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
}
.qa.focused .qfield {
  border-color: var(--accent);
}
.qplus {
  flex: none;
  color: var(--accent-fg);
}
.qfield input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 13.5px;
}
.qfield kbd {
  flex: none;
  padding: 0 5px;
  border: 1px solid var(--border-2);
  border-radius: var(--r1);
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.qchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 22px;
  padding: 0 2px 0 7px;
  border-radius: var(--r2);
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
  font-family: var(--font-data);
  font-size: 11.5px;
}
.qchip button {
  display: inline-flex;
  padding: 3px;
  border: 0;
  background: transparent;
  color: inherit;
}
.qb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--text-2);
}
.qgo {
  height: 34px;
  padding: 0 14px;
}
.qprev {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 10px 7px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
}
.hint {
  color: var(--dim);
  overflow: hidden;
  text-overflow: ellipsis;
}
.hint b {
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.pv {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 20px;
  padding: 0 7px;
  border-radius: var(--r2);
  background: var(--panel-3);
  color: var(--text-2);
}
.pv.day.other {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.pv.time {
  font-family: var(--font-data);
  color: var(--text);
}
.pv.time i {
  color: var(--muted);
  font-style: normal;
}
/* the time parts look like plain text; the wheel / the keys / typing change them */
.pv .tp {
  width: 5ch;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--r1);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
  cursor: ns-resize;
}
.pv .tp:hover,
.pv .tp:focus {
  background: var(--hover);
  outline: 1px solid var(--accent-line);
}
.pv.day {
  cursor: ns-resize;
}
.pv.day:hover,
.pv.day:focus {
  outline: 1px solid var(--accent-line);
}
.pv.kind i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--c);
}
.pv.task {
  max-width: 340px;
  background: rgba(68, 138, 255, 0.14);
  color: var(--info-fg);
  font-family: var(--font-data);
}
.pv.task.unknown {
  background: rgba(255, 183, 77, 0.14);
  color: var(--warn-fg);
}
.pv.task .ts {
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-ui);
  color: var(--text-2);
}
.pv.lbl {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  background: transparent;
  color: var(--text);
}
.grow {
  flex: 1;
}
.enter {
  flex: none;
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.qa-sug {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.qs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
}
.qs.on {
  background: var(--accent-soft);
}
.qs b {
  flex: none;
  font-family: var(--font-data);
  font-size: 12px;
  font-weight: 600;
}
.qss {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}
</style>
