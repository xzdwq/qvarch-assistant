<script setup lang="ts">
import Icon from '@renderer/components/Icon.vue'

/** The note's table of contents: its headings, a click goes there (it follows the text by itself). */
defineProps<{ headings: Array<{ level: number; text: string; pos: number }> }>()
const emit = defineEmits<{ go: [pos: number] }>()
</script>

<template>
  <div class="toc tw:flex tw:flex-col tw:gap-1 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="toc-h tw:flex tw:items-center tw:gap-6 tw:mb-4 tw:text-muted tw:text-[12px]"><Icon name="list" :size="13" />Оглавление</div>
    <button v-for="(h, i) in headings" :key="i" class="toc-i tw:h-26 tw:border-0 tw:rounded-[5px] tw:bg-transparent tw:text-accent-fg tw:text-[0.92em] tw:text-left tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:hover:bg-hover tw:hover:underline tw:hover:enabled:border-border-3" :style="{ paddingLeft: `${(h.level - 1) * 16 + 8}px` }" @mousedown.prevent @click="emit('go', h.pos)">{{ h.text }}</button>
    <p v-if="!headings.length" class="toc-e tw:my-2 tw:mx-8 tw:text-muted tw:text-[12.5px]">Заголовков пока нет — начните строку с # , ## или ###</p>
  </div>
</template>
