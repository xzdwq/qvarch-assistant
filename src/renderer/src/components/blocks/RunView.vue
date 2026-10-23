<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BlockRun } from '../../lib/runbook'
import { pretty } from '../../lib/runbook'
import { useGrid } from '../../lib/grid'
import { copyMd } from '../../lib/copyMd'
import type { LoopBlockKind } from '../../lib/loopView'
import CodeArea from '../CodeArea.vue'
import DataGrid from '../DataGrid.vue'
import Icon from '../Icon.vue'
import Markdown from '../Markdown.vue'

/** One run of a block, compact (a loop's pass shown apart): a text, rows, an answer, a value — or what went wrong. */
const props = defineProps<{ kind: LoopBlockKind; run?: BlockRun; value?: unknown }>()
const table = computed(() => (props.kind === 'sql' ? props.run?.table : undefined))
const grid = useGrid(table, () => 'Результат')
const text = computed(() => (props.kind === 'tpl' ? (typeof props.value === 'string' ? props.value : typeof props.run?.value === 'string' ? props.run.value : undefined) : undefined))
const copied = ref(false)
async function copy(): Promise<void> {
  if (text.value === undefined) return
  await copyMd(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
const shown = computed(() => {
  if (props.kind === 'http') return props.run?.response ? props.run.response.body : props.value === undefined ? undefined : pretty((props.value as { body?: unknown }).body ?? props.value)
  return props.value !== undefined ? pretty(props.value) : props.run?.hasValue ? pretty(props.run.value) : undefined
})
</script>

<template>
  <div class="rv">
    <p v-if="run?.state === 'run'" class="muted">выполняется…</p>
    <p v-else-if="run?.state === 'error'" class="er">{{ run.error }}</p>
    <template v-else-if="kind === 'tpl'">
      <div v-if="text !== undefined" class="rv-t">
        <Markdown class="rv-md" :text="text" />
        <button class="ib" :title="copied ? 'Скопировано' : 'Копировать: с оформлением и как текст Markdown'" @mousedown.prevent @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
      </div>
    </template>
    <DataGrid v-else-if="table" :grid="grid" :max-height="260" />
    <template v-else>
      <p v-if="kind === 'http' && run?.response" class="st" :class="{ bad: run.response.status >= 400 }">{{ run.response.status }} {{ run.response.statusText }} <span class="muted">{{ Math.round(run.response.time) }} мс</span></p>
      <CodeArea v-if="shown !== undefined" :model-value="shown" lang="json" readonly :min-height="24" />
      <p v-else-if="!run" class="muted">Результат этого прохода не сохранён (старые проходы длинного цикла хранят только значения).</p>
    </template>
  </div>
</template>

<style scoped>
.rv {
  min-width: 0;
  contain: inline-size;
}
.rv :deep(.cm-editor) {
  max-height: 260px;
}
.rv-t {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.rv-md {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  user-select: text;
}
.muted {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}
.er {
  margin: 0;
  color: var(--down-fg);
  font-size: 12px;
  white-space: pre-wrap;
}
.st {
  margin: 0 0 4px;
  color: var(--up-fg);
  font-family: var(--font-data);
  font-size: 12px;
}
.st.bad {
  color: var(--down-fg);
}
.ib {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
