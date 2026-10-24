<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * A compact chip of a toolbar (the same height as the task / link chips) that opens a small list over
 * everything — choices never push the card's layout around.
 */
/** `square` — the card's row of small square buttons. */
defineProps<{ icon: string; label?: string; title: string; active?: boolean; width?: number; square?: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const btn = ref<HTMLElement>()
</script>

<template>
  <div class="pc tw:relative tw:flex-none tw:inline-flex">
    <button ref="btn" class="pchip tw:inline-flex tw:items-center tw:justify-center tw:gap-6 tw:h-32 tw:min-w-32 tw:box-border tw:py-0 tw:px-10 tw:[&.sq]:h-26 tw:[&.sq]:min-w-26 tw:[&.sq]:px-6 tw:[&.sq]:text-[12px] tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-muted tw:text-[12.5px] tw:whitespace-nowrap tw:cursor-pointer tw:hover:not-[&.open]:not-[&.on]:border-accent tw:[&.open]:not-[&.on]:border-accent tw:hover:not-[&.open]:not-[&.on]:text-text tw:[&.open]:not-[&.on]:text-text tw:[&.on]:border-accent/70 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:hover:enabled:not-[&.on]:bg-hover" :class="{ on: active, open, sq: square }" :title="title" @click="open = !open">
      <Icon :name="icon" :size="square ? 13 : 14" />
      <span v-if="label" class="pl tw:font-semibold">{{ label }}</span>
    </button>
    <Popover v-model:open="open" :anchor="btn" :width="width ?? 220" align-left :chrome="8" class="pcdd tw:flex tw:flex-col tw:gap-1 tw:p-5 tw:overflow-y-auto tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)] tw:text-[12.5px] tw:text-text">
      <slot :close="() => (open = false)" />
    </Popover>
  </div>
</template>

<style src="./PopChip.global.css"></style>
