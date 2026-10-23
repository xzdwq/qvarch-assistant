<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { remoteError } from '../../../shared/remoteError'
import type { JiraVersion } from '@shared/jira'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * A Jira release (a fix version of any project in the settings): the unreleased ones first, then — after a
 * divider — the released, page by page as the list scrolls; a search over them. × — forget the picked one.
 */
const props = defineProps<{ modelValue?: JiraVersion; busy?: boolean; info?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: JiraVersion | undefined] }>()

const open = ref(false)
const q = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()

const items = shallowRef<JiraVersion[]>([])
const total = ref(0)
const unreleased = ref(0)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load(reset: boolean): Promise<void> {
  if (!reset && (loading.value || items.value.length >= total.value)) return
  const my = ++seq
  loading.value = true
  error.value = ''
  try {
    const r = await window.qa.jiraVersions(q.value, reset ? 0 : items.value.length, 40)
    if (my !== seq) return
    items.value = reset ? r.items : [...items.value, ...r.items]
    total.value = r.total
    unreleased.value = r.unreleased
  } catch (e) {
    if (my === seq) error.value = remoteError(e)
  } finally {
    if (my === seq) loading.value = false
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  timer = setTimeout(() => void load(true), 180)
})
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  q.value = ''
  void load(true)
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
function onScroll(e: Event): void {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight > el.scrollHeight - 120) void load(false)
}
function pick(v: JiraVersion): void {
  open.value = false
  emit('update:modelValue', v)
}
const date = (d?: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '')
/** Enter — the first release found (Esc — the popover's). */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && items.value[0]) pick(items.value[0])
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span ref="root" class="jrp tw:group/jrp tw:inline-flex tw:items-center tw:gap-2 tw:min-w-0" :class="{ on: !!modelValue }">
    <button class="jrb tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap tw:group-[.on]/jrp:border-accent-line tw:[&.open]:not-group-[.on]/jrp:border-accent-line tw:group-[.on]/jrp:text-text-hi tw:[&.open]:not-group-[.on]/jrp:text-text-hi tw:hover:enabled:bg-hover tw:hover:enabled:not-group-[.on]/jrp:not-[&.open]:border-border-3" :class="{ open }" :title="modelValue ? `Релиз ${modelValue.project} · ${modelValue.name}` : 'Отметить ветки задач релиза Jira'" @click="toggle">
      <Icon class="tw:first:text-info" name="jira" :size="12" />
      <template v-if="modelValue"><b class="tw:font-data tw:text-[11px] tw:text-info-fg">{{ modelValue.project }}</b>{{ modelValue.name }}</template>
      <template v-else>Релиз Jira</template>
      <Icon class="tw:first:text-info" name="chevronDown" :size="11" />
    </button>
    <button v-if="modelValue" class="jrx tw:inline-flex tw:p-5 tw:border-0 tw:bg-transparent tw:text-muted tw:hover:text-down-fg tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="Сбросить релиз (отмеченные ветки остаются)" @click="emit('update:modelValue', undefined)"><Icon name="x" :size="11" /></button>
    <span v-if="busy" class="jri tw:ml-6 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]">задачи релиза…</span>
    <span v-else-if="info" class="jri tw:ml-6 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]">{{ info }}</span>
  </span>
  <Popover v-slot="{ room }" v-model:open="open" :anchor="root" :width="380" align-left :chrome="60" max-height="none" class="jr-pop tw:flex tw:flex-col tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:overflow-hidden">
      <div class="sbox tw:flex tw:items-center tw:gap-8 tw:py-8 tw:px-10 tw:border-b tw:border-b-border tw:text-muted">
        <Icon name="search" :size="13" />
        <input class="tw:flex-1 tw:min-w-0 tw:p-0 tw:border-0 tw:outline-none tw:bg-transparent" ref="input" v-model="q" placeholder="Найти релиз: проект, версия" spellcheck="false" @keydown="onKey" />
      </div>
      <div class="items tw:overflow-y-auto tw:p-4" :style="{ maxHeight: `${room}px` }" @scroll.passive="onScroll">
        <template v-for="(v, i) in items" :key="v.id">
          <div v-if="i === 0 && unreleased" class="div tw:mt-6 tw:mr-6 tw:mb-3 tw:ml-6 tw:pb-3 tw:border-b tw:border-b-border tw:text-muted tw:font-data tw:text-[10px] tw:tracking-[0.06em] tw:uppercase">Невыпущенные · {{ unreleased }}</div>
          <div v-if="i === unreleased" class="div tw:mt-6 tw:mr-6 tw:mb-3 tw:ml-6 tw:pb-3 tw:border-b tw:border-b-border tw:text-muted tw:font-data tw:text-[10px] tw:tracking-[0.06em] tw:uppercase">Выпущенные · {{ total - unreleased }}</div>
          <button class="it tw:flex tw:items-center tw:gap-8 tw:w-full tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:not-[&.cur]:bg-hover tw:[&.cur]:bg-accent-soft tw:[&.rel]:text-text-2 tw:hover:enabled:border-border-3" :class="{ cur: modelValue?.id === v.id, rel: v.released }" @click="pick(v)">
            <b class="tw:flex-none tw:w-34 tw:text-info-fg tw:font-data tw:text-[11px]">{{ v.project }}</b>
            <span class="nm tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">{{ v.name }}</span>
            <span v-if="v.releaseDate" class="dt tw:flex-none tw:text-muted tw:font-data tw:text-[11px]">{{ date(v.releaseDate) }}</span>
          </button>
        </template>
        <p v-if="loading && !items.length" class="empty tw:m-10 tw:text-muted tw:text-[12px]">Загрузка релизов…</p>
        <p v-else-if="error" class="empty err tw:m-10 tw:text-[12px] tw:text-down-fg">{{ error }}</p>
        <p v-else-if="!items.length" class="empty tw:m-10 tw:text-muted tw:text-[12px]">Релизов не найдено</p>
      </div>
  </Popover>
</template>
