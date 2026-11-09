<script setup lang="ts">
import FoldHead from '../../ui/FoldHead.vue'
import { useBlockFold } from '../../ui/blockFold'
import Markdown from '@renderer/components/Markdown.vue'

/** The note's table of contents: its headings, a click goes there (it follows the text by itself). */
const props = defineProps<{ headings: Array<{ level: number; text: string; pos: number }>; onGo?: (pos: number) => void }>()
/** Folded to its head (the host's fold, kept per block): the chevron at the head's start. */
const fold = useBlockFold()
</script>

<template>
  <div class="toc tw:flex tw:flex-col tw:gap-1 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="toc-h tw:flex tw:items-center tw:gap-6 tw:mb-4 tw:text-muted tw:text-[12px]"><FoldHead icon="list" kind="Оглавление" :fold="fold" /></div>
    <template v-if="!fold || fold.open">
    <button v-for="(h, i) in headings" :key="i" class="toc-i tw:h-26 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-accent-fg tw:text-[0.92em] tw:text-left tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:hover:bg-hover tw:hover:underline tw:hover:enabled:border-border-3" :style="{ paddingLeft: `${(h.level - 1) * 16 + 8}px` }" @mousedown.prevent @click="props.onGo?.(h.pos)"><Markdown inline :text="h.text" /></button>
    <p v-if="!headings.length" class="toc-e tw:my-2 tw:mx-8 tw:text-muted tw:text-[12.5px]">Заголовков пока нет — начните строку с # , ## или ###</p>
    </template>
  </div>
</template>
