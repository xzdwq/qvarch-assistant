<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import type { Placements } from './usePlacements'
import type { Signatures } from './useSignatures'

/** The side panel of signatures: each one clicked onto the page in view or dragged onto a page; a new one made. */
const props = defineProps<{ signatures: Signatures; placements: Placements; hasDoc: boolean }>()
const { sigs, padOpen, remove } = props.signatures
const { addToPage, onDragStart } = props.placements
const openPad = () => (padOpen.value = true)
</script>

<template>
  <aside class="side tw:flex-none tw:w-220 tw:flex tw:flex-col tw:border-r tw:border-r-border">
    <div class="sh tw:flex tw:items-center tw:justify-between tw:h-44 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-14 tw:border-b tw:border-b-border tw:text-[13px]">
      <b>Подписи</b>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-26 tw:h-26 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-white/7 tw:hover:text-text tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:not-hover:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Создать подпись" @click="openPad"><Icon name="plus" :size="14" /></button>
    </div>
    <div class="sigs tw:flex-1 tw:overflow-auto tw:flex tw:flex-col tw:gap-8 tw:p-10">
      <div v-for="s in sigs" :key="s.id" class="sig tw:group/sig tw:relative tw:flex tw:items-center tw:justify-center tw:h-80 tw:p-6 tw:rounded-[4px] tw:bg-text-hi tw:cursor-grab tw:border-2 tw:border-transparent tw:hover:border-accent" draggable="true" :title="hasDoc ? 'Клик — на страницу, или перетащите' : 'Откройте PDF'" @dragstart="onDragStart($event, s.url)" @click="hasDoc && addToPage(s.url)">
        <img class="tw:max-w-full tw:max-h-full tw:pointer-events-none" :src="s.url" alt="" />
        <button class="sx tw:absolute tw:top-4 tw:right-4 tw:hidden tw:p-3 tw:border-0 tw:rounded-r2 tw:bg-black/55 tw:text-text-hi tw:group-hover/sig:inline-flex tw:[.zoom_&]:not-group-hover/sig:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:text-muted tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover tw:hover:enabled:not-[.zoom_&]:border-border-3" title="Удалить" @click.stop="remove(s.id)"><Icon name="x" :size="11" /></button>
      </div>
      <button v-if="!sigs.length" class="sadd tw:flex tw:flex-col tw:items-center tw:gap-6 tw:py-18 tw:px-8 tw:border tw:border-dashed tw:border-border tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:text-[12.5px] tw:hover:text-text tw:hover:border-accent tw:[.zoom_&]:inline-flex tw:[.zoom_&]:py-4 tw:[.zoom_&]:px-6 tw:[.zoom_&]:not-hover:border-0 tw:[.zoom_&]:bg-transparent tw:[.zoom_&]:not-hover:text-muted tw:[.zoom_&]:hover:text-text tw:hover:enabled:not-[.zoom_&]:bg-hover" @click="openPad"><Icon name="signature" :size="16" />Создать подпись</button>
    </div>
  </aside>
</template>
