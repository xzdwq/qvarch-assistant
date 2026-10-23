<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import { todayKey } from '../lib/today'
import { openEventInWork } from '../lib/mentions'
import Icon from './Icon.vue'
import { beside, useFollow } from '../lib/floating'

/**
 * When a task was / will be worked on: a timeline icon with the number of its blocks; a click — the list (the day,
 * the period, how long; the latest first), a block opened in «Моя работа» on its day. Nothing when there is none.
 */
export type Worked = { day: string; id: string; start: number; end: number }
const props = defineProps<{ blocks: Worked[] }>()
const list = computed(() => [...props.blocks].sort((a, b) => b.start - a.start))
const total = computed(() => props.blocks.reduce((s, b) => s + Math.max(0, b.end - b.start), 0))
const open = ref<{ x: number; y: number }>()
/** The chip it opened from: the list stays by it, closes when it is out of sight. */
let anchor: HTMLElement | undefined
const popEl = ref<HTMLElement>()
const at = (r: DOMRect) => beside(r, 300, popEl.value?.offsetHeight ?? 320, true)
useFollow(
  open,
  () => anchor,
  (r) => open.value && (open.value = at(r)),
  () => (open.value = undefined),
)
function toggle(e: Event): void {
  if (open.value) return void (open.value = undefined)
  anchor = e.currentTarget as HTMLElement
  open.value = at(anchor.getBoundingClientRect())
}
const dayText = (d: string) => {
  const s = new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) !== todayKey.value.slice(0, 4) ? { year: 'numeric' } : {}) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const away = (e: PointerEvent) => !(e.target as HTMLElement).closest('.twk-pop, .twk') && (open.value = undefined)
window.addEventListener('pointerdown', away, true)
onBeforeUnmount(() => window.removeEventListener('pointerdown', away, true))
function go(b: Worked): void {
  open.value = undefined
  openEventInWork(b.day, b.id)
}
</script>

<template>
  <button v-if="blocks.length" class="twk" :class="{ on: !!open }" :title="`На таймлайне: ${blocks.length} · всего ${formatDuration(total)}`" @click.stop="toggle">
    <Icon name="timeline" :size="13" /><b>{{ blocks.length }}</b>
  </button>
  <span v-else></span>
  <Teleport to="body">
    <div v-if="open" ref="popEl" class="twk-pop" :style="{ left: `${open.x}px`, top: `${open.y}px` }" @pointerdown.stop>
      <p class="cap">На таймлайне · {{ formatDuration(total) }}</p>
      <button v-for="b in list" :key="b.id" :class="{ fut: b.day > todayKey }" @click="go(b)">
        <span class="d">{{ dayText(b.day) }}</span>
        <span class="t">{{ formatHM(b.start) }}–{{ formatHM(b.end) }}</span>
        <span class="u">{{ formatDuration(b.end - b.start) }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.twk {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border-2);
  border-radius: 11px;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
}
.twk b {
  font-weight: 600;
}
.twk:hover,
.twk.on {
  border-color: var(--accent);
  color: var(--accent-fg);
}
.twk-pop {
  position: fixed;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 300px;
  max-height: 320px;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--border-2);
  border-radius: var(--r3);
  background: var(--pop);
  box-shadow: var(--shadow);
}
.cap {
  margin: 2px 6px 6px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.twk-pop button {
  display: grid;
  grid-template-columns: 1fr auto 52px;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  text-align: left;
}
.twk-pop button:hover {
  background: var(--hover);
}
.twk-pop button.fut .d,
.twk-pop button.fut .t {
  color: var(--info-fg);
}
.t,
.u {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
.u {
  color: var(--muted);
  text-align: right;
}
</style>
