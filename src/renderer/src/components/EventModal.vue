<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Entry } from '@shared/types'
import type { TaskRef } from '@shared/jira'
import { MINUTE } from '@shared/timeline'
import { useDay } from '../lib/useDay'
import { todayKey } from '../lib/today'
import EntryEditor, { type AddPrefs, type Draft } from './EntryEditor.vue'
import Icon from './Icon.vue'

/** "В событие" / «В работу»: a new block in a window over everything, its text (or a Jira task) filled in; today unless another date is picked in it. */
const props = defineProps<{ text: string; task?: TaskRef }>()
const emit = defineEmits<{ close: []; created: [day: string, entry: Entry] }>()

const today = todayKey
const { data, now } = useDay(today)
const add = ref<AddPrefs>({ from: 'now', back: false, min: 30 })
const draft = computed<Draft>(() => {
  const b = Math.floor(now.value / MINUTE) * MINUTE
  const span = add.value.min * MINUTE
  return { start: add.value.back ? b - span : b, end: add.value.back ? b : b + span, kind: 'task', label: props.text, source: 'manual', ...(props.task ? { task: { key: props.task.key, summary: props.task.summary } } : {}), followsNow: add.value.back, startsNow: !add.value.back }
})
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="em-back tw:fixed tw:inset-0 tw:z-1500 tw:flex tw:items-start tw:justify-center tw:pt-70 tw:bg-bg/50" @pointerdown.self="emit('close')">
      <div class="em tw:w-520 tw:max-w-[calc(100vw-32px)] tw:max-h-[calc(100vh-100px)] tw:overflow-auto tw:pt-12 tw:pr-16 tw:pb-16 tw:pl-16 tw:rounded-r3 tw:border tw:border-white/10 tw:bg-panel tw:[box-shadow:0_24px_60px_rgba(0,0,0,0.6)]">
        <div class="em-head tw:flex tw:items-center tw:gap-6 tw:mb-10 tw:text-text-2 tw:text-[12.5px] tw:font-semibold">
          <Icon name="plus" :size="13" /><span>Событие</span>
          <span class="grow tw:flex-1"></span>
          <button class="x tw:inline-flex tw:p-5 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:bg-white/8 tw:hover:enabled:border-border-3" title="Закрыть" @click="emit('close')"><Icon name="x" :size="14" /></button>
        </div>
        <EntryEditor
          :day="today"
          :entry="draft"
          :recent="[]"
          :now="now"
          :entries="data.entries"
          :notes="data.notes"
          :add="add"
          textarea
          @update:add="(a) => (add = a)"
          @saved="(e, d) => (emit('created', d, e), emit('close'))"
        />
      </div>
    </div>
  </Teleport>
</template>
