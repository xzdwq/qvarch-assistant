<script setup lang="ts">
import { toRef } from 'vue'
import { usePopover, type Placement, type PopoverAnchor } from '../lib/usePopover'

/**
 * A popover: over everything (teleported to <body>), beside its anchor and kept with it (or at a point), closed by a
 * press outside or Esc (usePopover). The classes / listeners it is given go onto its panel; the content is the slot
 * (with `close`, `up` — opened upwards, `room` — the height there is).
 */
defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    anchor: PopoverAnchor
    width?: number | ((el: HTMLElement) => number)
    alignLeft?: boolean
    chrome?: number
    maxHeight?: 'none' | ((room: number) => number)
    place?: Placement
    esc?: boolean
    /** the name of a <Transition> it comes and goes with (none — at once) */
    transition?: string
  }>(),
  { width: 220, alignLeft: false, chrome: 48, maxHeight: undefined, place: undefined, esc: true, transition: undefined },
)
const open = defineModel<boolean>('open', { required: true })
const { panelRef, style, up, room, close } = usePopover(toRef(props, 'anchor'), props, open)
</script>

<template>
  <Teleport to="body">
    <Transition :name="transition" :css="!!transition">
      <div v-if="open" :ref="panelRef" v-bind="$attrs" :style="style">
        <slot :close="close" :up="up" :room="room" />
      </div>
    </Transition>
  </Teleport>
</template>
