<script setup lang="ts">
/**
 * «Связи»: the notes linked to this one and related to it by the notebook's graph — with why (a link here or from
 * here, a shared tag, a table, a request…), the strongest first. Read when opened; a click opens one.
 */
import { ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { reasonText, type RelatedNote } from '@shared/notebook/graph'
import { dirOf, noteName } from '@nb/domain/notePaths'
import { openFile } from '@nb/workspace/paneLayout'

const props = defineProps<{ path: string }>()
/** Why a note is related — this many reasons shown (all of them — in its hint). */
const REASONS_SHOWN = 3
const btn = ref<HTMLElement>()
const open = ref(false)
const list = ref<RelatedNote[]>()
async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  list.value = undefined
  list.value = (await window.qa.vaultRelated(props.path).catch(() => undefined))?.related ?? []
}
function go(p: string): void {
  open.value = false
  openFile(p)
}
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button class="tb tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg" :class="{ on: open }" title="Связи — ссылки сюда и отсюда, общие теги, таблицы, запросы" @click="toggle"><Icon name="link" :size="14" /></button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="360" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:max-h-[min(480px,70vh)] tw:p-8 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px] tw:overflow-y-auto">
    <span class="tw:px-4 tw:pb-4 tw:text-muted">Связи</span>
    <span v-if="!list" class="tw:px-4 tw:text-muted">Ищу…</span>
    <span v-else-if="!list.length" class="tw:px-4 tw:text-muted">Нет связанных заметок</span>
    <button v-for="r in list" :key="r.path" class="tw:flex tw:flex-col tw:gap-2 tw:py-4 tw:px-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:hover:bg-hover" :title="`${r.path}\n${r.reasons.map(reasonText).join('\n')}`" @click="go(r.path)">
      <span class="tw:flex tw:items-center tw:gap-6 tw:min-w-0 tw:whitespace-nowrap"><Icon name="note" :size="12" /><span class="tw:min-w-0 tw:truncate">{{ noteName(r.path) }}</span><span class="tw:min-w-0 tw:truncate tw:text-muted tw:text-[11.5px]">{{ dirOf(r.path) }}</span></span>
      <span class="tw:flex tw:gap-4 tw:min-w-0 tw:pl-18 tw:overflow-hidden tw:whitespace-nowrap">
        <span v-for="(x, i) in r.reasons.slice(0, REASONS_SHOWN)" :key="i" class="tw:flex-none tw:max-w-150 tw:truncate tw:py-0 tw:px-5 tw:rounded-r2 tw:bg-white/6 tw:text-muted tw:text-[11px]">{{ reasonText(x) }}</span>
        <span v-if="r.reasons.length > REASONS_SHOWN" class="tw:flex-none tw:text-dim tw:text-[11px]">+{{ r.reasons.length - REASONS_SHOWN }}</span>
      </span>
    </button>
  </Popover>
</template>
