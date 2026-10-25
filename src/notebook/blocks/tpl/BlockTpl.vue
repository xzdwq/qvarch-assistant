<script setup lang="ts">
import { computed, ref } from 'vue'
import { interpolate } from '@nb/domain/values'
import { blockRunKey } from '@nb/domain/noteBlocks'
import { envAtLine } from '@nb/engine'
import { doc } from '@renderer/lib/notebook'
import { useFold } from '@renderer/lib/foldState'
import { copyMd } from '@renderer/lib/copyMd'
import CodeArea from '@renderer/components/CodeArea.vue'
import Icon from '@renderer/components/Icon.vue'
import Markdown from '@renderer/components/Markdown.vue'
import RunHead from '../../ui/RunHead.vue'
import { useFenceSource } from '../../ui/useFenceSource'

/**
 * «Текст по шаблону» (```md template name=…): Markdown — bold, lists, tables, emoji, quotes — with {{ values }} of the
 * note, filled as they are (nothing to run): shown as it reads, copied formatted (a chat, Jira, an e-mail) and as
 * text, published under its name. In a loop — filled on every pass: all the texts together under it.
 */
const props = defineProps<{ src: string; path: string; line: number; inLoop?: boolean; onChange?: (src: string) => void }>()
const fence = useFenceSource(props)
const { parts, body } = fence
const rename = (name: string | undefined) => fence.patchInfo({ name })
const key = computed(() => blockRunKey(parts.value.info.name, 'tpl', props.line, parts.value.info.id))

/** The text filled with the note's values now (what is missing — said, the text not published with holes). */
const filled = computed(() => {
  if (props.inLoop) return undefined
  // (the env's values are read through Vue: the text follows them)
  return interpolate(body.value, envAtLine(props.path, props.line, doc(props.path).text).values())
})
const missing = computed(() => [...new Set(filled.value?.missing ?? [])])
const missingText = computed(() => missing.value.map((m) => `{{${m}}}`).join(', '))
// (published under its name by the note itself, when whole — syncTemplates: the ones off screen too)
const open = useFold(() => `${props.path}#${key.value}#result`, true)
const copied = ref(false)
async function copy(): Promise<void> {
  if (!filled.value) return
  await copyMd(filled.value.text)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="bt tw:contain-[inline-size] tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-10 tw:pb-10 tw:pl-10 tw:border tw:border-border tw:[&&]:border-l-3 tw:[&&]:border-l-(--block-tpl) tw:rounded-[8px] tw:bg-panel">
    <RunHead icon="note" kind="Шаблон" :name="parts.info.name" :can-run="false" name-placeholder="текст" @rename="rename" />
    <div class="bt-ed"><CodeArea v-model="body" lang="markdown" :min-height="40" placeholder="✅ **{{ user.body.data.email }}** — {{ rows[0].status }}" /></div>
    <div v-if="filled" class="bt-res tw:border tw:border-border-2 tw:rounded-[8px] tw:bg-bg">
      <div class="bt-rh tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:py-2 tw:px-6 tw:border-b tw:border-b-border tw:text-[12.5px] tw:whitespace-nowrap">
        <button class="fold tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" :title="open ? 'Свернуть' : 'Показать'" @mousedown.prevent @click="open = !open"><Icon name="chevronRight" :size="12" :style="open ? 'transform: rotate(90deg)' : ''" /></button>
        <b>Текст</b>
        <span v-if="missing.length" class="warn tw:overflow-hidden tw:text-warn-fg tw:text-[12px] tw:text-ellipsis" title="Выполните блоки, которые дают эти значения">нет значения: {{ missingText }}</span>
        <span v-else-if="parts.info.name" class="muted tw:text-muted">→ {{ '{' }}{{ '{' }}{{ parts.info.name }}{{ '}' }}{{ '}' }}</span>
        <span class="grow tw:flex-1"></span>
        <button class="ib tw:inline-grid tw:flex-none tw:place-items-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" :title="copied ? 'Скопировано' : 'Копировать: с оформлением (чат, Jira, письмо) и как текст Markdown'" @mousedown.prevent @click="copy"><Icon :name="copied ? 'check' : 'copy'" :size="13" /></button>
      </div>
      <Markdown v-if="open" class="bt-md tw:py-6 tw:px-12 tw:select-text" :text="filled.text" />
    </div>
  </div>
</template>

<style scoped src="./BlockTpl.css"></style>
