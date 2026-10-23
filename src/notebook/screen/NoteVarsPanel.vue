<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import { usePopover, type Placement } from '@renderer/lib/usePopover'
import { clearNoteRuns, noteRun } from '@nb/engine'
import { summary } from '@nb/domain/values'
import { VALUE_FROM } from '@nb/domain/noteFacts'

/**
 * «Переменные заметки»: what the note's blocks published (name, from where, value), where «Выполнить всё» stopped —
 * a popover under its button (its right edge at the button's), kept by it.
 */
const props = defineProps<{ path: string; anchor: HTMLElement }>()
const emit = defineEmits<{ close: [] }>()
const open = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const underButton: Placement = ({ rect }) => ({ style: { left: `${Math.max(8, Math.min(rect.right - 360, window.innerWidth - 370))}px`, top: `${rect.bottom + 6}px` } })
const { panelRef, style } = usePopover(() => props.anchor, { place: underButton }, open)
</script>

<template>
  <div :ref="panelRef" class="nrun-ctx tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-2 tw:w-360 tw:max-h-420 tw:p-8 tw:overflow-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]" :style="style">
    <div class="nrc-h tw:flex tw:items-center tw:gap-8 tw:pt-0 tw:pr-2 tw:pb-6 tw:pl-2"><b>Переменные заметки</b><span class="grow tw:flex-1"></span><button class="tw:[.zoom_&]:min-w-20 tw:[.zoom_&]:rounded-none tw:[.zoom_&]:text-[11px] tw:[.zoom_&]:hover:bg-white/8 tw:[.zoom_&]:hover:text-text tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-24 tw:p-0 tw:border-0 tw:bg-transparent tw:text-muted" title="Очистить контекст и результаты" @click="clearNoteRuns(path)"><Icon name="trash" :size="12" /></button></div>
    <div v-for="(it, k) in noteRun(path).ctx" :key="k" class="nrc-r tw:grid tw:grid-cols-[minmax(0,auto)_auto_minmax(0,1fr)] tw:items-center tw:gap-8 tw:py-4 tw:px-6 tw:rounded-r2 tw:hover:bg-hover" :title="`{{ ${k} }} — из блока «${it.block}» · ${new Date(it.at).toLocaleString('ru-RU')}`">
      <code class="tw:text-accent-fg tw:font-data">{{ k }}</code><span class="nrc-f tw:text-dim tw:text-[11px]">{{ VALUE_FROM[it.from] }}</span><span class="nrc-v tw:overflow-hidden tw:text-text-2 tw:font-data tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap">{{ summary(it.value) }}</span>
    </div>
    <p v-if="!Object.keys(noteRun(path).ctx).length" class="nrc-e tw:m-4 tw:text-muted tw:text-[12px]">Пока пусто: выполните блоки — их результаты появятся здесь. В тексте: {{ '{' }}{{ '{' }} имя.путь {{ '}' }}{{ '}' }}</p>
    <p v-if="noteRun(path).all?.error" class="nrc-err tw:m-4 tw:text-[12px] tw:text-down-fg">Остановилось на «{{ noteRun(path).all!.at }}»: {{ noteRun(path).all!.error }}</p>
  </div>
</template>
