<script setup lang="ts">
/**
 * The terminal's bottom panel (as in VS Code), opened by TERMINAL in the status line: popped over the window, held to
 * the status line — or pinned into the window's grid (the sections above make room for it), whatever section is open.
 * Its head dragged up or down — its height; height and pinning kept. Esc stays the shell's: only the button or ×
 * close it. Popped, it lives in <body> — the browser's native pages make way for it as for any popover.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { dockHeight } from '@shared/terminalDock'
import Icon from '../../components/Icon.vue'
import { dockOn, termDock, termSlot } from '../../lib/termDock'

/** The window's zoom, % (the terminal is as big as in its section). */
defineProps<{ zoom: number }>()
const box = ref<HTMLElement>()
const winH = ref(window.innerHeight)
const onResize = () => (winH.value = window.innerHeight)
onMounted(() => {
  termSlot('dock', box.value)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  termSlot('dock', undefined, box.value)
  window.removeEventListener('resize', onResize)
})
const height = computed(() => dockHeight(termDock.h, winH.value))

/** The head dragged: the panel taller (up) or lower (down). */
let drag: { y: number; h: number } | undefined
function startDrag(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  drag = { y: e.clientY, h: height.value }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
const onDrag = (e: PointerEvent) => drag && (termDock.h = dockHeight(drag.h + drag.y - e.clientY, winH.value))
const endDrag = () => (drag = undefined)
const iconBtn = 'tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:[&.on]:text-accent-fg'
</script>

<template>
  <Teleport to="body" :disabled="termDock.pinned">
    <section
      v-show="dockOn"
      class="tw:flex tw:flex-col tw:min-h-0 tw:bg-panel tw:[&.pop]:fixed tw:[&.pop]:left-0 tw:[&.pop]:right-0 tw:[&.pop]:bottom-24 tw:[&.pop]:z-1200 tw:[&.pop]:border tw:[&.pop]:border-border-2 tw:[&.pop]:border-b-0 tw:[&.pop]:rounded-t-[14px] tw:[&.pop]:[box-shadow:var(--shadow-pop-edge)] tw:[&.pop]:overflow-hidden tw:[&.pin]:relative tw:[&.pin]:flex-none tw:[&.pin]:border-t tw:[&.pin]:border-t-border-2"
      :class="termDock.pinned ? 'pin' : 'pop'"
      :style="{ height: `${height}px` }"
    >
      <!-- the head: drag it up / down — the height -->
      <div class="tw:relative tw:flex tw:flex-none tw:items-center tw:gap-6 tw:h-24 tw:px-10 tw:cursor-ns-resize tw:select-none tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.05em]" title="Потяните вверх или вниз — высота панели" @pointerdown="startDrag" @pointermove="onDrag" @pointerup="endDrag" @pointercancel="endDrag">
        <span class="tw:absolute tw:left-1/2 tw:top-3 tw:w-36 tw:h-3 tw:-ml-18 tw:rounded-full tw:bg-white/14"></span>
        <Icon name="terminal" :size="12" class="tw:text-accent-fg" />TERMINAL
        <span class="tw:flex-1"></span>
        <button :class="[iconBtn, { on: termDock.pinned }]" :title="termDock.pinned ? 'Открепить: панель всплывает поверх окна' : 'Закрепить внизу окна: разделы подвинутся'" @click="termDock.pinned = !termDock.pinned"><Icon name="pin" :size="12" /></button>
        <button :class="iconBtn" title="Скрыть (так же — TERMINAL в строке состояния)" @click="termDock.open = false"><Icon name="x" :size="12" /></button>
      </div>
      <div ref="box" class="tw:flex-1 tw:min-h-0" :style="{ zoom: zoom / 100 }"></div>
    </section>
  </Teleport>
</template>
