<script setup lang="ts">
import FoldHead from '../../ui/FoldHead.vue'
import { useBlockFold } from '../../ui/blockFold'
import { computed, ref, shallowRef, watch } from 'vue'
import { noteVarNames } from '@nb/domain/tableVars'
import SuggestInput from '@renderer/components/SuggestInput.vue'
import ValueView from '../../ui/ValueView.vue'
import { resolvePath, summary } from '@nb/domain/values'
import { joinFence, splitFence } from '@nb/domain/fence'
import { clearValue, envAtLine, noteRun } from '@nb/engine'
import { TEXT_VALUE_SOURCES } from '@nb/domain/blockInfo'
import { doc, setText } from '@nb/workspace/noteDocs'
import { savesOf, withSaveBlock } from '../save/modelNotes'
import Icon from '@renderer/components/Icon.vue'

/**
 * A value of the note's context shown live (```json ref=login.body): it changes when its block runs again. In a loop —
 * the pass shown. (As a table — the notebook's table «Из переменной».)
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
/** Folded to its head (the host's fold, kept per block): the chevron at the head's start. */
const fold = useBlockFold()
const parts = computed(() => splitFence(props.src))
const draft = ref(parts.value.info.ref ?? '')
watch(
  () => parts.value.info.ref,
  (r) => (draft.value = r ?? ''),
)
/** The path typed written into the block's info line (ref=…; empty — none chosen yet, the block stays a «Значение»). */
function commit(v = draft.value): void {
  const p = splitFence(props.src)
  const ref = v.trim()
  if (ref !== p.info.ref) props.onChange?.(joinFence(p.fence, { ...p.info, ref }, p.body))
}
/** «Следить»: the value shown as it grows while its run goes on (written into the info line as `watch`). */
function toggleWatch(): void {
  const p = splitFence(props.src)
  props.onChange?.(joinFence(p.fence, { ...p.info, watch: p.info.watch ? undefined : true }, p.body))
}
/** The variables offered: this note's — its blocks' names and the values it holds now. */
const names = computed(() => [...new Set([...noteVarNames(doc(props.path).text), ...Object.keys(noteRun(props.path).ctx)])].sort())
/** The value now (the env's values are read through Vue: it follows them and the pass picked). */
const now = computed(() => (parts.value.info.ref ? resolvePath(envAtLine(props.path, props.line, doc(props.path).text).values(), parts.value.info.ref) : { ok: false }))
/** The variable's root name — what is cleared (the whole variable, not a part of it). */
const root = computed(() => /^[A-Za-z_$][\w$]*/.exec(parts.value.info.ref ?? '')?.[0] ?? '')
/** The variable it shows, as the note holds it (when it changed; gathered by emit() in a run that did not end well). */
const item = computed(() => (root.value ? noteRun(props.path).ctx[root.value] : undefined))
/** Its run goes on and the block does not watch: the value as it was before (none — not shown till the run ends). */
const growing = computed(() => !!item.value?.running)
const settled = shallowRef<{ ok: boolean; value?: unknown }>()
// (another variable chosen: what was kept of the last one is not shown for it)
watch(
  () => parts.value.info.ref,
  () => (settled.value = undefined),
)
watch(
  [now, growing],
  ([r, g]) => {
    if (!g) settled.value = r
  },
  { immediate: true },
)
const res = computed(() => (parts.value.info.watch || !growing.value ? now.value : (settled.value ?? { ok: false })))
const from = computed(() => (item.value ? new Date(item.value.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''))
const clearable = computed(() => !!item.value && !TEXT_VALUE_SOURCES.has(item.value.from))
const clear = () => clearValue(props.path, root.value)
/** The variable kept as a file each run already (a «Сохранить в файл» block of the note); put one at the note's end. */
const saving = computed(() => !!parts.value.info.ref && savesOf(doc(props.path).text, parts.value.info.ref))
function saveEachRun(): void {
  const ref = parts.value.info.ref
  if (!ref || saving.value) return
  setText(props.path, withSaveBlock(doc(props.path).text, ref))
}
</script>

<template>
  <div class="br tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-ref) tw:rounded-[8px] tw:bg-panel">
    <div class="br-h tw:flex tw:items-center tw:gap-10 tw:text-[12px] tw:whitespace-nowrap">
      <FoldHead icon="eye" kind="Значение" :fold="fold" />
      <label class="rn tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-dim tw:font-data"><span>{{ '{' }}{{ '{' }}</span><SuggestInput v-model="draft" class="tw:w-180 tw:h-22 tw:py-0 tw:px-3 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:outline-none" :options="names" placeholder="переменная" title="Переменная заметки (можно путь: login.body, logs.lines)" @commit="commit" @cancel="draft = parts.info.ref ?? ''" /><span>{{ '}' }}{{ '}' }}</span></label>
      <span class="muted tw:min-w-0 tw:truncate tw:text-muted tw:text-[11.5px]">{{ res.ok ? summary(res.value) : '' }}</span>
      <span class="grow tw:flex-1"></span>
      <span v-if="growing" class="tw:flex-none tw:text-accent-fg tw:text-[11.5px]" :title="parts.info.watch ? 'Блок, который публикует значение, ещё выполняется — показывается вживую' : 'Блок, который публикует значение, ещё выполняется — здесь покажется, когда он закончит (или включите «Следить»)'">{{ parts.info.watch ? '● вживую' : 'выполняется…' }}</span>
      <button
        v-if="parts.info.ref"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:text-accent-fg"
        :class="{ on: parts.info.watch }"
        :title="parts.info.watch ? 'Следить: включено — значение обновляется, пока блок-источник выполняется (поток логов, emit)' : 'Следить: показывать значение вживую, пока блок-источник выполняется (иначе — когда он закончит)'"
        @mousedown.prevent
        @click="toggleWatch"
      >
        <Icon name="follow" :size="12" />
      </button>
      <span v-if="item?.partial" class="tw:text-warn-fg tw:text-[11.5px]" title="Накоплено через emit() в запуске, который не закончился успешно (остановлен, упал) — сохранено то, что успело прийти">частично</span>
      <span v-if="from" class="muted tw:text-muted tw:text-[11.5px]">обновлено {{ from }}</span>
      <button
        v-if="parts.info.ref"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:text-accent-fg"
        :class="{ on: saving }"
        :title="saving ? 'Сохраняется в файл каждый прогон — блок «Сохранить в файл» в заметке' : 'Сохранять в файл каждый прогон: добавить в конец заметки блок «Сохранить в файл»'"
        @mousedown.prevent
        @click="saveEachRun"
      >
        <Icon name="download" :size="12" />
      </button>
      <button
        v-if="clearable"
        class="tw:inline-flex tw:flex-none tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text"
        :title="`Очистить {{${root}}} — переменной не будет, пока блок не опубликует её снова (накопление с keep= начнётся заново)`"
        @mousedown.prevent
        @click="clear"
      >
        <Icon name="eraser" :size="12" />
      </button>
    </div>
    <template v-if="!fold || fold.open">
    <div v-if="res.ok" class="br-v"><ValueView :value="res.value" /></div>
    <p v-else class="muted none tw:text-muted tw:text-[11.5px] tw:m-0">{{ !parts.info.ref ? 'Выберите переменную заметки.' : growing ? 'Блок ещё выполняется — значение покажется, когда он закончит. «Следить» — смотреть вживую.' : 'Нет значения — выполните блок, который его публикует.' }}</p>
    </template>
  </div>
</template>

<style scoped src="./BlockRef.css"></style>
