<script setup lang="ts">
import { computed } from 'vue'
import { usePopover } from '../lib/usePopover'
import Icon from './Icon.vue'
import type { MenuItem } from './MenuButton.vue'

/**
 * A menu at the point of a right click (over chosen cells, a row…): over everything, inside the window; closed by a
 * click elsewhere, Esc, or anything scrolling (it stood by what has moved).
 */
const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ close: [] }>()
const open = computed({ get: () => true, set: (on) => void (on || emit('close')) })
const { panelRef, style } = usePopover(() => ({ x: props.x, y: props.y }), {}, open)
function pick(it: MenuItem): void {
  if (it.disabled) return
  emit('close')
  void it.run()
}
</script>

<template>
  <Teleport to="body">
    <div :ref="panelRef" class="cx-menu tw:fixed tw:z-5000 tw:flex tw:min-w-180 tw:flex-col tw:p-4 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop" :style="style" @contextmenu.prevent>
      <button class="tw:flex tw:items-center tw:gap-8 tw:h-30 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:whitespace-nowrap tw:hover:enabled:bg-hover tw:disabled:opacity-45" v-for="(it, i) in items" :key="i" :disabled="it.disabled" :title="it.title" @mousedown.prevent @click="pick(it)">
        <Icon v-if="it.icon" :name="it.icon" :size="13" />{{ it.label }}
      </button>
    </div>
  </Teleport>
</template>
