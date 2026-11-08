<script setup lang="ts">
/**
 * A component's kind at the start of its head — its icon and name; with the fold (every component of a note folds
 * the same way) — one button with the chevron: folded, only the head stays. The slot — something said beside the kind.
 */
import Icon from '@renderer/components/Icon.vue'

defineProps<{ icon: string; kind: string; fold?: { readonly open: boolean; set(open: boolean): void }; dim?: boolean }>()
</script>

<template>
  <button v-if="fold" class="rk tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:py-0 tw:pr-6 tw:pl-2 tw:border-0 tw:rounded-full tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:hover:bg-hover tw:hover:text-text tw:[&.out]:opacity-60" :class="{ out: dim }" :title="fold.open ? 'Свернуть (останется заголовок)' : 'Развернуть'" @mousedown.prevent @click="fold.set(!fold.open)">
    <Icon :name="fold.open ? 'chevronDown' : 'chevronRight'" :size="13" /><Icon :name="icon" :size="13" />{{ kind }}<slot />
  </button>
  <span v-else class="rk tw:inline-flex tw:flex-none tw:items-center tw:gap-6 tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:[&.out]:opacity-60" :class="{ out: dim }"><Icon :name="icon" :size="13" />{{ kind }}<slot /></span>
</template>
