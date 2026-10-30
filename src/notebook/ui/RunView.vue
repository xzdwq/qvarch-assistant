<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BlockRun } from '@nb/engine'
import { useGrid } from '@renderer/lib/grid'
import { copyMd } from '@renderer/lib/copyMd'
import ValueView from './ValueView.vue'
import DataGrid from '@renderer/components/DataGrid.vue'
import Icon from '@renderer/components/Icon.vue'
import Markdown from '@renderer/components/Markdown.vue'
import type { PassResultShape } from './blockView'

/** One run of a block, compact (a loop's pass shown apart): a text, rows, an answer, a value — or what went wrong. */
const props = defineProps<{ shape: PassResultShape; run?: BlockRun; value?: unknown }>()
const table = computed(() => (props.shape === 'rows' ? props.run?.table : undefined))
const grid = useGrid(table, () => 'Результат')
const text = computed(() => (props.shape === 'markdown' ? (typeof props.value === 'string' ? props.value : typeof props.run?.value === 'string' ? props.run.value : undefined) : undefined))
const copied = ref(false)
async function copy(): Promise<void> {
  if (text.value === undefined) return
  await copyMd(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
/** The answer's body (an HTTP answer) or the value (none — nothing kept of this pass). */
const shown = computed((): { v: unknown } | undefined => {
  if (props.shape === 'answer') return props.run?.response ? { v: props.run.response.body } : props.value === undefined ? undefined : { v: (props.value as { body?: unknown }).body ?? props.value }
  return props.value !== undefined ? { v: props.value } : props.run?.hasValue ? { v: props.run.value } : undefined
})
</script>

<template>
  <div class="rv tw:min-w-0 tw:contain-[inline-size]">
    <p v-if="run?.state === 'run'" class="muted tw:m-0 tw:text-muted tw:text-[12px]">выполняется…</p>
    <p v-else-if="run?.state === 'error'" class="er tw:m-0 tw:text-down-fg tw:text-[12px] tw:whitespace-pre-wrap">{{ run.error }}</p>
    <template v-else-if="shape === 'markdown'">
      <div v-if="text !== undefined" class="rv-t tw:flex tw:items-start tw:gap-4">
        <Markdown class="rv-md tw:flex-1 tw:min-w-0 tw:py-2 tw:px-6 tw:select-text" :text="text" />
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" :title="copied ? 'Скопировано' : 'Копировать: с оформлением и как текст Markdown'" @mousedown.prevent @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
      </div>
    </template>
    <DataGrid v-else-if="table" :grid="grid" :max-height="260" />
    <template v-else>
      <p v-if="shape === 'answer' && run?.response" class="st tw:mt-0 tw:mr-0 tw:mb-4 tw:ml-0 tw:text-up-fg tw:font-data tw:text-[12px] tw:[&.bad]:text-down-fg" :class="{ bad: run.response.status >= 400 }">{{ run.response.status }} {{ run.response.statusText }} <span class="muted tw:m-0 tw:text-muted tw:text-[12px]">{{ Math.round(run.response.time) }} мс</span></p>
      <ValueView v-if="shown" :value="shown.v" parse />
      <p v-else-if="!run" class="muted tw:m-0 tw:text-muted tw:text-[12px]">Результат этого прохода не сохранён (старые проходы длинного цикла хранят только значения).</p>
    </template>
  </div>
</template>

<style scoped src="./RunView.css"></style>
