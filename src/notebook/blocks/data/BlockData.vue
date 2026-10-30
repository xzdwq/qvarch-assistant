<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { noteRun, publishData } from '@nb/engine'
import { summary } from '@nb/domain/values'
import { formatCode } from '@shared/codeformat'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import RunHead from '../../ui/RunHead.vue'
import { useFenceSource } from '../../ui/useFenceSource'

/**
 * Data in a note (JSON / YAML): in the note's context under its name as soon as it parses — a test set for
 * a code block, a body for a request. A big one folds down to one line.
 */
const props = defineProps<{ src: string; path: string; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { parts, body: text } = fence
/** The parse error of the data (none — it is published). */
const error = ref<string>()
let publishTimer: ReturnType<typeof setTimeout> | undefined
watch(
  text,
  () => {
    clearTimeout(publishTimer)
    publishTimer = setTimeout(() => {
      const i = parts.value.info
      if (i.name) error.value = publishData(props.path, i.name, i.lang, text.value)
    }, 300)
  },
  { immediate: true },
)
const rename = (name: string | undefined) => fence.patchInfo({ name })
const setLang = (lang: 'json' | 'yaml') => fence.patchInfo({ lang })
const value = computed(() => (parts.value.info.name ? noteRun(props.path).ctx[parts.value.info.name]?.value : undefined))
// a big set starts folded
const open = ref(text.value.split('\n').length <= 15)
/** Formatted in its language (indents; YAML keeps its comments); not parsing — said why, the text kept. */
const formatError = ref('')
async function format(): Promise<void> {
  formatError.value = ''
  try {
    text.value = await formatCode(parts.value.info.lang, text.value)
    open.value = true
  } catch (e) {
    formatError.value = `Не отформатировать: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`
  }
}
</script>

<template>
  <div class="bd tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:py-8 tw:px-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-data) tw:rounded-[8px] tw:bg-panel">
    <RunHead icon="braces" kind="Данные" :name="parts.info.name" :can-run="false" name-placeholder="данные" @rename="rename">
      <span class="seg tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: parts.info.lang === 'json' }" @mousedown.prevent @click="setLang('json')">JSON</button>
        <button class="tw:h-22 tw:py-0 tw:px-7 tw:border-0 tw:rounded-none tw:bg-transparent tw:text-muted tw:font-data tw:text-[11px] tw:[&.on]:bg-accent/20 tw:[&.on]:text-accent-fg" :class="{ on: parts.info.lang === 'yaml' }" @mousedown.prevent @click="setLang('yaml')">YAML</button>
      </span>
      <button class="tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" :title="`Отформатировать ${parts.info.lang === 'yaml' ? 'YAML' : 'JSON'} (отступы)`" @mousedown.prevent @click="format"><Icon name="code" :size="12" /></button>
      <button class="fold tw:inline-flex tw:items-center tw:gap-4 tw:h-22 tw:py-0 tw:px-6 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-text-2 tw:font-data tw:text-[11.5px] tw:hover:bg-hover tw:hover:enabled:border-border-3" :title="open ? 'Свернуть' : 'Развернуть'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" />{{ error ? 'ошибка' : summary(value) }}</button>
    </RunHead>
    <div v-if="open" class="bd-ed"><CodeArea v-model="text" :lang="parts.info.lang" :min-height="30" placeholder='[{ "id": 1, "price": 120 }]' /></div>
    <p v-if="error || formatError" class="er tw:m-0 tw:text-down-fg tw:text-[12px]">{{ formatError || error }}</p>
    <p v-else-if="!parts.info.name" class="hint tw:m-0 tw:text-muted tw:text-[11.5px]">Дайте имя — тогда данные доступны блокам кода, запросам и тексту.</p>
  </div>
</template>

<style scoped src="./BlockData.css"></style>
