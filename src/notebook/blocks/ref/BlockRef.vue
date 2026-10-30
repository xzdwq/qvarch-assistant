<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ValueView from '../../ui/ValueView.vue'
import { resolvePath, summary } from '@nb/domain/values'
import { joinFence, splitFence } from '@nb/domain/fence'
import { clearValue, envAtLine, noteRun } from '@nb/engine'
import { TEXT_VALUE_SOURCES } from '@nb/domain/blockInfo'
import { doc, setText } from '@renderer/lib/notebook'
import { savesOf, withSaveBlock } from '../save/modelNotes'
import Icon from '@renderer/components/Icon.vue'

/**
 * A value of the note's context shown live (```json ref=login.body): it changes when its block runs again. In a loop —
 * the pass shown. (As a table — the notebook's table «Из переменной».)
 */
const props = defineProps<{ src: string; path: string; line: number; onChange?: (src: string) => void }>()
const parts = computed(() => splitFence(props.src))
const draft = ref(parts.value.info.ref ?? '')
watch(
  () => parts.value.info.ref,
  (r) => (draft.value = r ?? ''),
)
/** The path typed written into the block's info line (ref=…). */
function commit(): void {
  const p = splitFence(props.src)
  const ref = draft.value.trim() || undefined
  if (ref !== p.info.ref) props.onChange?.(joinFence(p.fence, { ...p.info, ref }, p.body))
}
/** The value now (the env's values are read through Vue: it follows them and the pass picked). */
const res = computed(() => (parts.value.info.ref ? resolvePath(envAtLine(props.path, props.line, doc(props.path).text).values(), parts.value.info.ref) : { ok: false }))
/** The variable's root name — what is cleared (the whole variable, not a part of it). */
const root = computed(() => /^[A-Za-z_$][\w$]*/.exec(parts.value.info.ref ?? '')?.[0] ?? '')
/** The variable it shows, as the note holds it (when it changed; gathered by emit() in a run that did not end well). */
const item = computed(() => (root.value ? noteRun(props.path).ctx[root.value] : undefined))
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
      <span class="rk tw:inline-flex tw:items-center tw:gap-6 tw:text-muted"><Icon name="eye" :size="13" />Значение</span>
      <label class="rn tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-bg tw:text-dim tw:font-data"><span>{{ '{' }}{{ '{' }}</span><input class="tw:w-180 tw:h-22 tw:py-0 tw:px-3 tw:border-0 tw:bg-transparent tw:text-accent-fg tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px] tw:outline-none" v-model="draft" spellcheck="false" placeholder="login.body" @blur="commit" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" /><span>{{ '}' }}{{ '}' }}</span></label>
      <span class="muted tw:text-muted tw:text-[11.5px]">{{ res.ok ? summary(res.value) : '' }}</span>
      <span class="grow tw:flex-1"></span>
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
    <div v-if="res.ok" class="br-v"><ValueView :value="res.value" /></div>
    <p v-else class="muted none tw:text-muted tw:text-[11.5px] tw:m-0">Нет значения — выполните блок, который его публикует.</p>
  </div>
</template>

<style scoped src="./BlockRef.css"></style>
