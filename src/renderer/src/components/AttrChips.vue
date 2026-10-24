<script setup lang="ts">
import { computed } from 'vue'
import { attrChips, chipsTitle, type EntryAttrs } from '@shared/tracker/attributes'
import { attrDefs } from '../lib/attributes'

/**
 * An event's attributes: compact — each value's letters in its attribute's colour (the names in the tooltip); `full`
 * (an event's card) — «Проект: Альфа» each.
 */
const props = defineProps<{ attrs?: EntryAttrs; full?: boolean }>()
const chips = computed(() => attrChips(attrDefs.value, props.attrs))
</script>

<template>
  <span v-if="chips.length && full" class="tw:inline-flex tw:flex-wrap tw:items-center tw:gap-4">
    <span v-for="c in chips" :key="c.id" class="tw:inline-flex tw:items-center tw:gap-4 tw:h-20 tw:pl-2 tw:pr-6 tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_16%,transparent)] tw:text-text tw:text-[12px]" :style="{ '--c': c.color }">
      <i class="tw:inline-flex tw:items-center tw:h-16 tw:px-4 tw:rounded-r1 tw:not-italic tw:font-data tw:text-[9.5px] tw:font-bold tw:text-text-hi tw:[background:var(--c)]">{{ c.short }}</i>{{ c.name }}: <b class="tw:font-semibold">{{ c.value }}</b>
    </span>
  </span>
  <span v-else-if="chips.length" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-2" :title="chipsTitle(chips)">
    <i v-for="c in chips" :key="c.id" class="tw:inline-flex tw:items-center tw:h-16 tw:px-4 tw:rounded-r1 tw:not-italic tw:font-data tw:text-[9.5px] tw:font-bold tw:leading-none tw:text-text-hi" :style="{ background: c.color }">{{ c.short }}</i>
  </span>
</template>
