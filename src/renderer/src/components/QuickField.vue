<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { formatHM } from '@shared/timeline'
import { parseQuick, type Quick } from '@shared/quickadd'
import type { TaskRef } from '@shared/jira'
import { kindColor, kindLabel, kinds } from '../lib/palette'
import { useQuickSuggest } from '../tracker/quick/useQuickSuggest'
import { mondayOf } from '../lib/useRange'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * The one way to type a new event, everywhere: the first line is understood as it is typed — time
 * («14:00-15:30», «в 9:30»), duration («30м», «1ч»), a task («ABC-123»), a kind («#встреча»), a day («завтра»,
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
/** «@» task / «#» kind suggestions: a picked one is handed to the owner (the textarea keeps its line breaks). */
const { summaryOf, sug, active, sugOpen, updateSug, pickSug, onSugKey } = useQuickSuggest({
  text: () => props.modelValue,
  setText: (t) => emit('update:modelValue', t),
  field: () => el.value,
  kinds: () => kinds.value.filter((k) => !k.hidden),
  blanks: / {2,}/g,
  onPick: (type, it) => (type === '#' ? emit('kind', it.id) : emit('task', { key: it.id, summary: it.sub ?? '' })),
  stopOnPick: true,
})
const firstLine = computed(() => props.modelValue.split('\n')[0])
const q = computed(() => parseQuick(firstLine.value, { day: props.day, weekStart: mondayOf(props.day), kinds: kinds.value }))
const task = computed<TaskRef | undefined>(() => (q.value.task ? { key: q.value.task, summary: summaryOf(q.value.task) } : undefined))
watch([q, task], () => emit('parsed', { q: q.value, task: task.value }), { immediate: true })

/** The recognised parts, as chips. */
const chips = computed(() => {
  const out: Array<{ cls: 'day' | 'time' | 'kind' | 'task' | 'task unknown'; text: string; title?: string; color?: string }> = []
  const x = q.value
  if (x.day !== props.day) out.push({ cls: 'day', text: new Date(`${x.day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }) })
  if (x.start !== undefined) out.push({ cls: 'time', text: x.end !== undefined ? `${formatHM(x.start)}–${formatHM(x.end)}` : `с ${formatHM(x.start)}` })
  if (x.dur && x.start === undefined) out.push({ cls: 'time', text: x.parts.find((p) => p.type === 'dur')?.text ?? '' })
  if (x.kind) out.push({ cls: 'kind', text: kindLabel(x.kind), color: kindColor(x.kind) })
  if (task.value) out.push({ cls: task.value.summary ? 'task' : 'task unknown', text: task.value.key, title: task.value.summary || 'Задача не найдена в списке' })
  return out
})

/** The field's keys: the «@» / «#» list first while it is open; Enter submits (unless it makes a new line). */
function onKey(e: KeyboardEvent): void {
  if (onSugKey(e)) return
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
  <div ref="wrapEl" class="qf tw:flex tw:flex-col tw:gap-5 tw:min-w-0">
    <textarea
      ref="el"
      class="qft tw:w-full tw:min-h-34 tw:resize-none tw:overflow-auto tw:py-7 tw:px-9 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:font-[inherit] tw:[&&]:text-[13px] tw:[&&]:leading-[1.4] tw:focus:border-accent tw:focus:outline-none"
      :value="modelValue"
      :rows="rows"
      spellcheck="false"
      :placeholder="placeholder ?? 'Что делали — 14:00-15:00, 30м, ABC-123, #вид, завтра · @ задача'"
      @input="(emit('update:modelValue', ($event.target as HTMLTextAreaElement).value), updateSug())"
      @click="updateSug"
      @keydown="onKey"
      @blur="sug = undefined"
    ></textarea>
    <div v-if="chips.length" class="qfc tw:flex tw:items-center tw:gap-5 tw:overflow-hidden tw:whitespace-nowrap tw:text-[11.5px]">
      <span v-for="(c, i) in chips" :key="i" class="ch tw:group/ch tw:inline-flex tw:items-center tw:gap-4 tw:flex-none tw:h-19 tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2 tw:[&.day]:not-[&.task]:bg-accent-soft tw:[&.day]:not-[&.time]:not-[&.task]:text-accent-fg tw:[&.time]:not-[&.task]:font-data tw:[&.time]:not-[&.task]:text-text tw:[&.task]:bg-info/15 tw:[&.task]:text-info-fg tw:[&.task]:font-data tw:[&.task]:[&.unknown]:bg-warn/14 tw:[&.task]:[&.unknown]:text-warn-fg" :class="c.cls" :title="c.title" :style="c.color ? { '--c': c.color } : {}"><i class="tw:group-[.kind]/ch:w-7 tw:group-[.kind]/ch:h-7 tw:group-[.kind]/ch:rounded-[2px] tw:group-[.kind]/ch:[background:var(--c)]" v-if="c.cls === 'kind'"></i>{{ c.text }}</span>
      <span v-if="q.label" class="lbl tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-muted">«{{ q.label }}»</span>
    </div>
    <Popover v-model:open="sugOpen" :anchor="wrapEl" :width="380" align-left :chrome="0" max-height="none" :esc="false" class="qf-sug tw:flex tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" @mousedown.prevent>
        <button v-for="(it, i) in sug!.items" :key="it.id" class="qs tw:flex tw:items-center tw:gap-8 tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:[&.on]:bg-accent-soft tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:border-border-3" :class="{ on: i === active }" @mouseenter="active = i" @click="pickSug(i)">
          <Icon :name="it.icon" :size="13" :style="it.color ? { color: it.color } : {}" />
          <b class="tw:flex-none tw:font-data tw:text-[12px]">{{ it.title }}</b>
          <span v-if="it.sub" class="qss tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:text-text-2">{{ it.sub }}</span>
        </button>
    </Popover>
  </div>
</template>
