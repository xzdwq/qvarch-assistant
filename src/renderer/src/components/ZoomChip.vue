<script setup lang="ts">
/**
 * The one scale control of the app (the window, the notebook, a board, a PDF): the wheel over it changes the
 * scale by ~10%, a click puts it back to 100%.
 */
const props = withDefaults(defineProps<{ modelValue: number; min?: number; max?: number; title?: string }>(), { min: 25, max: 400 })
const emit = defineEmits<{ 'update:modelValue': [pct: number] }>()

function set(v: number): void {
  const n = Math.min(props.max, Math.max(props.min, Math.round(v / 5) * 5))
  if (n !== props.modelValue) emit('update:modelValue', n)
}
function onWheel(e: WheelEvent): void {
  e.preventDefault()
  e.stopPropagation()
  const up = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0
  const v = props.modelValue
  // ~10% a notch, at least 5 points
  set(up ? Math.max(v + 5, v * 1.1) : Math.min(v - 5, v / 1.1))
}
</script>

<template>
  <button class="zc tw:group/zc tw:inline-flex tw:items-center tw:gap-5 tw:flex-none tw:h-24 tw:py-0 tw:px-8 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-field tw:text-muted tw:font-data tw:text-[11px] tw:tabular-nums tw:cursor-ns-resize tw:[-webkit-app-region:no-drag] tw:hover:border-accent tw:hover:text-accent-fg tw:hover:enabled:bg-hover" :class="{ off: Math.round(modelValue) !== 100 }" :title="title ?? 'Масштаб · колесо — изменить, клик — 100%'" @wheel="onWheel" @click="set(100)">
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    <span class="tw:min-w-34 tw:text-right tw:text-text-2 tw:group-[.off]/zc:text-accent-fg">{{ Math.round(modelValue) }}%</span>
  </button>
</template>
