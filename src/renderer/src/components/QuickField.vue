<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { formatHM } from '@shared/timeline'
import { parseQuick, type Quick } from '@shared/quickadd'
import { pickableTasks, type TaskRef } from '@shared/jira'
import { kindColor, kindLabel, kinds } from '../lib/palette'
import { useJira } from '../lib/jira'
import { useLocalTasks } from '../lib/tasks'
import { placeFloat, useAnchor } from '../lib/floating'
import { mondayOf } from '../lib/useRange'
import Icon from './Icon.vue'

/**
 * The one way to type a new event, everywhere: the first line is understood as it is typed — time
 * («14:00-15:30», «в 9:30»), duration («30м», «1ч»), a task («DOS-123»), a kind («#встреча»), a day («завтра»,
 * «пн», «20.10») — and what was understood shows under it. «@» picks a task, «#» a kind. The other lines are
 * the description. Enter — submit (Shift+Enter, or Enter with `enterNewline`, — a new line).
 */
export interface QuickParsed {
  q: Quick
  /** The task named in the text, with its summary when it is known. */
  task?: TaskRef
}
const props = withDefaults(defineProps<{ modelValue: string; day: string; placeholder?: string; enterNewline?: boolean; rows?: number; dropUp?: boolean }>(), { rows: 1 })
const emit = defineEmits<{
  'update:modelValue': [text: string]
  submit: []
  /** Picked from «#»: the kind. */
  kind: [id: string]
  /** Picked from «@»: the task. */
  task: [t: TaskRef]
  parsed: [p: QuickParsed]
}>()

const el = ref<HTMLTextAreaElement>()
const wrapEl = ref<HTMLElement>()
const jira = useJira()
const own = useLocalTasks()
const allTasks = computed<Array<TaskRef & { own: boolean }>>(() => [
  ...own.value.filter((t) => t.key && t.status !== 'done').map((t) => ({ key: t.key!, summary: t.title, own: true })),
  ...pickableTasks(jira.value).map((i) => ({ key: i.key, summary: i.summary, own: false })),
])
const summaryOf = (key: string) => allTasks.value.find((t) => t.key === key)?.summary ?? jira.value.issues.find((i) => i.key === key)?.summary ?? ''
const firstLine = computed(() => props.modelValue.split('\n')[0])
const q = computed(() => parseQuick(firstLine.value, { day: props.day, weekStart: mondayOf(props.day), kinds: kinds.value }))
const task = computed<TaskRef | undefined>(() => (q.value.task ? { key: q.value.task, summary: summaryOf(q.value.task) } : undefined))
watch([q, task], () => emit('parsed', { q: q.value, task: task.value }), { immediate: true })

/** The recognised parts, as chips. */
const chips = computed(() => {
  const out: Array<{ cls: string; text: string; title?: string; color?: string }> = []
  const x = q.value
  if (x.day !== props.day) out.push({ cls: 'day', text: new Date(`${x.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }) })
  if (x.start !== undefined) out.push({ cls: 'time', text: x.end !== undefined ? `${formatHM(x.start)}–${formatHM(x.end)}` : `с ${formatHM(x.start)}` })
  if (x.dur && x.start === undefined) out.push({ cls: 'time', text: x.parts.find((p) => p.type === 'dur')?.text ?? '' })
  if (x.kind) out.push({ cls: 'kind', text: kindLabel(x.kind), color: kindColor(x.kind) })
  if (task.value) out.push({ cls: task.value.summary ? 'task' : 'task unknown', text: task.value.key, title: task.value.summary || 'Задача не найдена в списке' })
  return out
})

// ---------- «@» / «#» ----------
type Sug = { type: '@' | '#'; from: number; items: Array<{ id: string; title: string; sub?: string; color?: string; icon: string }> }
const sug = ref<Sug>()
const active = ref(0)
const sugStyle = ref<Record<string, string>>({})
const sugOpen = computed(() => !!sug.value?.items.length)
useAnchor(sugOpen, wrapEl, () => {
  if (!wrapEl.value) return
  const f = placeFloat(wrapEl.value, 380, true, 0)
  sugStyle.value = f.style
})
function updateSug(): void {
  const t = el.value
  if (!t) return
  const before = props.modelValue.slice(0, t.selectionStart ?? props.modelValue.length)
  const m = before.match(/(^|\s)([@#])([^\s]*)$/)
  if (!m) return void (sug.value = undefined)
  const s = m[3].toLowerCase()
  const items =
    m[2] === '#'
      ? kinds.value.filter((k) => !k.hidden && k.label.toLowerCase().includes(s)).map((k) => ({ id: k.id, title: k.label, color: k.color, icon: k.icon }))
      : allTasks.value
          .filter((x) => x.key.toLowerCase().includes(s) || x.summary.toLowerCase().includes(s))
          .slice(0, 8)
          .map((x) => ({ id: x.key, title: x.key, sub: x.summary, icon: x.own ? 'checkSquare' : 'jira' }))
  sug.value = { type: m[2] as '@' | '#', from: before.length - m[2].length - m[3].length, items }
  active.value = 0
}
function pickSug(i: number): void {
  const s = sug.value
  const it = s?.items[i]
  if (!s || !it || !el.value) return
  const caret = el.value.selectionStart ?? props.modelValue.length
  emit('update:modelValue', `${props.modelValue.slice(0, s.from)}${props.modelValue.slice(caret)}`.replace(/ {2,}/g, ' '))
  if (s.type === '#') emit('kind', it.id)
  else emit('task', { key: it.id, summary: it.sub ?? '' })
  sug.value = undefined
  void nextTick(() => {
    el.value?.focus()
    el.value?.setSelectionRange(s.from, s.from)
  })
}
function onKey(e: KeyboardEvent): void {
  if (sugOpen.value) {
    const n = sug.value!.items.length
    if (e.key === 'ArrowDown') return void (e.preventDefault(), (active.value = (active.value + 1) % n))
    if (e.key === 'ArrowUp') return void (e.preventDefault(), (active.value = (active.value + n - 1) % n))
    if (e.key === 'Enter' || e.key === 'Tab') return void (e.preventDefault(), e.stopPropagation(), pickSug(active.value))
    if (e.key === 'Escape') return void (e.stopPropagation(), (sug.value = undefined))
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !props.enterNewline) {
    e.preventDefault()
    emit('submit')
  }
}
// the field grows with its lines
function fit(): void {
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  t.style.height = `${Math.min(160, t.scrollHeight + 2)}px`
}
watch(() => props.modelValue, () => void nextTick(fit))
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <div ref="wrapEl" class="qf">
    <textarea
      ref="el"
      class="qft"
      :value="modelValue"
      :rows="rows"
      spellcheck="false"
      :placeholder="placeholder ?? 'Что делали — 14:00-15:00, 30м, DOS-123, #вид, завтра · @ задача'"
      @input="(emit('update:modelValue', ($event.target as HTMLTextAreaElement).value), updateSug())"
      @click="updateSug"
      @keydown="onKey"
      @blur="sug = undefined"
    ></textarea>
    <div v-if="chips.length" class="qfc">
      <span v-for="(c, i) in chips" :key="i" class="ch" :class="c.cls" :title="c.title" :style="c.color ? { '--c': c.color } : {}"><i v-if="c.cls === 'kind'"></i>{{ c.text }}</span>
      <span v-if="q.label" class="lbl">«{{ q.label }}»</span>
    </div>
    <Teleport to="body">
      <div v-if="sugOpen" class="qf-sug" :style="sugStyle" @mousedown.prevent>
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
.qf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.qft {
  width: 100%;
  min-height: 34px;
  resize: none;
  overflow: auto;
  padding: 7px 9px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
}
.qft:focus {
  border-color: var(--accent);
  outline: none;
}
.qfc {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 11.5px;
}
.ch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 19px;
  padding: 0 6px;
  border-radius: var(--r2);
  background: var(--panel-3);
  color: var(--text-2);
}
.ch.day {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.ch.time {
  font-family: var(--font-data);
  color: var(--text);
}
.ch.kind i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  background: var(--c);
}
.ch.task {
  background: rgba(68, 138, 255, 0.15);
  color: var(--info-fg);
  font-family: var(--font-data);
}
.ch.task.unknown {
  background: rgba(255, 183, 77, 0.14);
  color: var(--warn-fg);
}
.lbl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}
.qf-sug {
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
}
.qss {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}
</style>
