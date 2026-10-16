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
  <button class="zc" :class="{ off: Math.round(modelValue) !== 100 }" :title="title ?? 'Масштаб · колесо — изменить, клик — 100%'" @wheel="onWheel" @click="set(100)">
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    <span>{{ Math.round(modelValue) }}%</span>
  </button>
</template>

<style scoped>
.zc {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: ns-resize;
  -webkit-app-region: no-drag;
}
.zc span {
  min-width: 34px;
  text-align: right;
  color: var(--text-2);
}
.zc:hover {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.zc.off span {
  color: var(--accent-fg);
}
</style>
