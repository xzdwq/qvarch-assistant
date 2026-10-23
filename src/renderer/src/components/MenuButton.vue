<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'
import Popover from './Popover.vue'

/**
 * One button for a few variants of one action (export: Excel / CSV / copy; a plan: estimated / measured) — the room
 * of one button; its menu over everything (teleported), kept by the button, closed when the button is out of sight.
 */
export interface MenuItem {
  label: string
  icon?: string
  title?: string
  disabled?: boolean
  run: () => unknown
}
withDefaults(defineProps<{ label?: string; icon?: string; title?: string; items: MenuItem[]; disabled?: boolean; width?: number }>(), { width: 220 })
const open = ref(false)
const btn = ref<HTMLElement>()
function pick(it: MenuItem): void {
  if (it.disabled) return
  open.value = false
  void it.run()
}
</script>

<template>
  <button ref="btn" class="mb tw:inline-flex tw:flex-none tw:items-center tw:gap-4 tw:h-24 tw:pt-0 tw:pr-8 tw:pb-0 tw:pl-10 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:whitespace-nowrap tw:[&.solo]:justify-center tw:[&.solo]:w-26 tw:[&.solo]:h-26 tw:[&.solo]:p-0 tw:[&.solo]:not-[&.on]:border-transparent tw:[&.solo]:rounded-[6px] tw:[&.on]:border-accent tw:[&&]:hover:enabled:border-accent tw:[&.on]:text-text tw:hover:enabled:text-text tw:disabled:opacity-50 tw:hover:enabled:bg-hover" :class="{ on: open, solo: !label }" :disabled="disabled" :title="title" @mousedown.prevent @click="open = !open">
    <Icon v-if="icon" :name="icon" :size="label ? 12 : 14" /><template v-if="label">{{ label }}<Icon name="chevronDown" :size="10" /></template>
  </button>
  <Popover v-model:open="open" :anchor="btn" :width="width" :chrome="0" class="mb-pop tw:flex tw:flex-col tw:p-4 tw:overflow-x-hidden tw:overflow-y-auto tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop">
      <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:overflow-hidden tw:text-left tw:text-ellipsis tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-45" v-for="(it, i) in items" :key="i" :disabled="it.disabled" :title="it.title" @mousedown.prevent @click="pick(it)">
        <Icon v-if="it.icon" :name="it.icon" :size="13" />{{ it.label }}
      </button>
  </Popover>
</template>
