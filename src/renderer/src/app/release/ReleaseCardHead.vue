<script setup lang="ts">
/** A card's head: its number, title and description, the actions slot and the fold arrow; a click toggles the card. */
defineProps<{ num: number; title: string; desc?: string; collapsed: boolean }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="ch tw:flex tw:items-start tw:gap-10 tw:mb-10 tw:cursor-pointer tw:select-none" @click="$emit('toggle')">
    <span class="num tw:flex tw:items-center tw:justify-center tw:flex-none tw:w-22 tw:h-22 tw:mt-1 tw:rounded-[50%] tw:bg-accent tw:text-on-accent tw:text-[12px] tw:font-semibold">{{ num }}</span>
    <div class="cht tw:flex-1 tw:min-w-0">
      <h3 class="tw:m-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">{{ title }}</h3>
      <div v-if="desc" class="cd tw:mt-2 tw:mr-0 tw:mb-0 tw:ml-0 tw:text-muted tw:text-[11px]">{{ desc }}</div>
    </div>
    <div class="chx tw:flex tw:items-center tw:gap-8 tw:flex-none tw:mt-1">
      <slot />
      <span class="arr tw:w-10 tw:text-muted tw:text-[10px] tw:text-center">{{ collapsed ? '▸' : '▾' }}</span>
    </div>
  </div>
</template>
