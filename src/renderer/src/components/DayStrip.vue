<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import type { Entry, Ms } from '@shared/types'
import { entryIcon, kindColor } from '../lib/palette'
import Icon from './Icon.vue'

/**
 * The day as a chain under the timeline: what was (faded, joined by a dotted line) · now · in
 * how long the next one starts · what is next (joined by plain lines). Flat cards with a coloured edge;
 * overflow scrolls sideways (the arrows move it).
 */
const props = defineProps<{ entries: Entry[]; now: Ms; countdown: 'any' | 'outlook' }>()

/** Only Outlook meetings when the countdown is to meetings (the setting); else every block. */
const sorted = computed(() =>
  [...props.entries].filter((e) => props.countdown === 'any' || !!e.outlook).sort((a, b) => a.start - b.start),
)
// what has finished (a live block — a call still growing — is not "past": it would blink in and out)
const past = computed(() => sorted.value.filter((e) => e.end <= props.now - 2 * 60_000).slice(-2))
const upcoming = computed(() => sorted.value.filter((e) => e.start > props.now).slice(0, 8))
/** What the countdown is to: the nearest one. */
const target = computed(() => upcoming.value[0])
const leftText = computed(() => {
  if (!target.value) return ''
  const m = Math.max(1, Math.round((target.value.start - props.now) / 60_000))
  return m < 60 ? `${m} мин` : formatDuration(m * 60_000)
})
const soon = computed(() => !!target.value && target.value.start - props.now <= 10 * 60_000)

// sideways: arrows when it does not fit
const row = ref<HTMLElement>()
const canL = ref(false)
const canR = ref(false)
function measure(): void {
  const el = row.value
  if (!el) return
  canL.value = el.scrollLeft > 2
  canR.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
}
function scrollBy(dir: 1 | -1): void {
  row.value?.scrollBy({ left: dir * Math.max(200, (row.value.clientWidth ?? 400) * 0.6), behavior: 'smooth' })
}
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(measure)
  if (row.value) ro.observe(row.value)
  measure()
})
onBeforeUnmount(() => ro?.disconnect())
const tint = (c: string) => ({ '--c': c })
const NOW = '#ff3d3d'
const NEXT = 'var(--accent)'
</script>

<template>
  <div class="ds">
    <button v-if="canL" class="arr l" @click="scrollBy(-1)"><Icon name="chevronLeft" :size="16" /></button>
    <div ref="row" class="chain" @scroll="measure">
      <!-- what was: faded, a dotted line on to the next -->
      <template v-for="e in past" :key="e.id">
        <div class="card past" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic"><Icon :name="entryIcon(e)" :size="15" :stroke="2" /></span>
          <span class="tx"><small>{{ formatHM(e.start) }} – {{ formatHM(e.end) }}</small><b>{{ e.label }}</b></span>
        </div>
        <span class="link dotted" style="--c: #6b7387"><i></i></span>
      </template>

      <!-- now -->
      <div class="card now" :style="tint(NOW)">
        <span class="ic"><Icon name="clock" :size="15" :stroke="2.2" /></span>
        <span class="tx"><b class="big">{{ formatHM(now) }}</b><small>Сейчас</small></span>
      </div>

      <!-- in how long the next one starts -->
      <template v-if="target">
        <span class="link dashed" :style="tint(NOW)"><i></i></span>
        <div class="card cd" :class="{ soon }" :style="tint(soon ? '#f59e0b' : NEXT)" :title="countdown === 'outlook' ? 'До встречи' : 'До следующего события'">
          <span class="ic"><Icon :name="entryIcon(target)" :size="15" :stroke="2.2" /></span>
          <span class="tx"><b>через {{ leftText }}</b></span>
        </div>
      </template>

      <!-- what is next: plain lines -->
      <template v-for="(e, i) in upcoming" :key="e.id">
        <span class="link" :style="{ '--c': i === 0 ? NEXT : kindColor(upcoming[i - 1].kind), '--d': kindColor(e.kind) }"><i></i></span>
        <div class="card" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic"><Icon :name="entryIcon(e)" :size="15" :stroke="2.2" /></span>
          <span class="tx"><small>{{ formatHM(e.start) }} – {{ formatHM(e.end) }}</small><b>{{ e.label }}</b></span>
        </div>
      </template>
      <span v-if="!upcoming.length && !target" class="none">Дальше событий нет</span>
    </div>
    <button v-if="canR" class="arr r" @click="scrollBy(1)"><Icon name="chevronRight" :size="16" /></button>
  </div>
</template>

<style scoped>
.ds {
  position: relative;
  display: flex;
  align-items: center;
  border-top: 1px solid var(--border);
}
.chain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 7px 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chain::-webkit-scrollbar {
  display: none;
}
/* a flat card with a coloured edge on the left */
.card {
  --c: var(--accent);
  flex: none;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 260px;
  height: 40px;
  box-sizing: border-box;
  padding: 0 14px 0 8px;
  border-radius: var(--r2);
  border-left: 3px solid var(--c);
  background: var(--panel-2);
}
.ic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--c) 32%, var(--panel-2));
  color: var(--text-hi);
}
.tx {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.tx small {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx b {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx .big {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
/* what was: no colour, faded */
.past {
  border-left-color: transparent;
  background: var(--panel);
  opacity: 0.6;
}
.past .ic {
  background: transparent;
  color: var(--muted);
}
.now .ic {
  background: var(--c);
}
.cd .tx b {
  font-size: 13px;
}
/* a connector: a line and a dot at its end, in the colour of what comes next */
.link {
  --c: var(--accent);
  --d: var(--c);
  flex: none;
  position: relative;
  width: 44px;
  height: 2px;
  margin-right: 4px;
  background: color-mix(in srgb, var(--c) 75%, transparent);
}
.link i {
  position: absolute;
  right: -4px;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-top: -4.5px;
  border-radius: 50%;
  background: var(--d);
}
.link.dotted {
  background: radial-gradient(circle, var(--c) 1px, transparent 1.5px) 0 50% / 6px 2px repeat-x;
}
.link.dashed {
  width: 28px;
  background: linear-gradient(90deg, var(--c) 50%, transparent 50%) 0 0 / 6px 2px repeat-x;
}
.none {
  margin-left: 14px;
  color: var(--muted);
  font-size: 12px;
}
.arr {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-top: -15px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--border-2);
  color: var(--text-2);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}
.arr.l {
  left: 6px;
}
.arr.r {
  right: 6px;
}
</style>
