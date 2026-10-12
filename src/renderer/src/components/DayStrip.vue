<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import type { Entry, Ms } from '@shared/types'
import { entryIcon, kindColor } from '../lib/palette'
import Icon from './Icon.vue'

/**
 * The day as a chain under the dashboard's timeline: the last two blocks · now · how long until the next ·
 * the next ones. Pills joined by little connectors; overflow scrolls sideways (the arrows move it).
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
</script>

<template>
  <div class="ds">
    <button v-if="canL" class="arr l" @click="scrollBy(-1)"><Icon name="chevronLeft" :size="16" /></button>
    <div ref="row" class="chain" @scroll="measure">
      <!-- what was -->
      <template v-for="e in past" :key="e.id">
        <div class="pill past" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic"><Icon :name="entryIcon(e)" :size="13" :stroke="2.2" /></span>
          <span class="tx"><small>{{ formatHM(e.start) }}–{{ formatHM(e.end) }} · {{ formatDuration(e.end - e.start) }}</small><b>{{ e.label }}</b></span>
        </div>
        <span class="link" :style="tint(kindColor(e.kind))"><i></i></span>
      </template>

      <!-- now -->
      <div class="pill now">
        <span class="ic"><Icon name="clock" :size="14" :stroke="2.2" /></span>
        <span class="tx"><b class="big">{{ formatHM(now) }}</b><small>Сейчас</small></span>
      </div>

      <!-- how long until the next -->
      <template v-if="target">
        <span class="link" style="--c: #8b7cff"><i></i></span>
        <div class="pill cd" :class="{ soon }">
          <span class="ic"><Icon name="clock" :size="13" :stroke="2.2" /></span>
          <span class="tx"><b>через {{ leftText }}</b><small>{{ countdown === 'outlook' ? 'до встречи' : 'до следующего события' }}</small></span>
        </div>
      </template>

      <!-- what is next -->
      <template v-for="e in upcoming" :key="e.id">
        <span class="link" :style="tint(kindColor(e.kind))"><i></i></span>
        <div class="pill ev" :class="{ first: e.id === target?.id }" :style="tint(kindColor(e.kind))" :title="e.label">
          <span class="ic"><Icon :name="entryIcon(e)" :size="13" :stroke="2.2" /></span>
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
  padding: 6px 10px;
  overflow-x: auto;
  scrollbar-width: none;
}
.chain::-webkit-scrollbar {
  display: none;
}
.pill {
  --c: #8b7cff;
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 230px;
  height: 34px;
  box-sizing: border-box;
  padding: 0 12px 0 4px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  background: color-mix(in srgb, var(--c) 12%, #141824);
}
.ic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--c) 55%, #1b2030);
  color: #fff;
}
.tx {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.tx small {
  color: #9aa3b8;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx b {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tx .big {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.past {
  opacity: 0.55;
}
.now {
  --c: #ef4444;
}
.now .tx small {
  max-width: 180px;
}
.cd {
  --c: #6366f1;
}
.cd.soon {
  --c: #f59e0b;
}
.ev.first {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent), 0 0 18px color-mix(in srgb, var(--c) 25%, transparent);
}
/* a connector: a short line with a dot */
.link {
  --c: #8b7cff;
  flex: none;
  position: relative;
  width: 18px;
  height: 2px;
  background: color-mix(in srgb, var(--c) 55%, transparent);
}
.link i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: var(--c);
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
  background: #262b3b;
  color: #cbd5e1;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}
.arr.l {
  left: 6px;
}
.arr.r {
  right: 6px;
}
</style>
