<script setup lang="ts">
import { computed } from 'vue'
import { formatDuration } from '@shared/timeline'

/** When the time is spent: weekdays × hours, the brighter the more; under it — the day's profile by hour. */
const props = defineProps<{ matrix: number[][] }>()
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
/** The hours shown: the working ones at least, more if anything happened outside. */
const hours = computed(() => {
  let lo = 8
  let hi = 20
  for (const row of props.matrix)
    row.forEach((v, h) => {
      if (v > 0) {
        lo = Math.min(lo, h)
        hi = Math.max(hi, h)
      }
    })
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
})
const max = computed(() => Math.max(1, ...props.matrix.flat()))
const byHour = computed(() => hours.value.map((h) => props.matrix.reduce((s, r) => s + r[h], 0)))
const maxHour = computed(() => Math.max(1, ...byHour.value))
const peak = computed(() => {
  const i = byHour.value.indexOf(Math.max(...byHour.value))
  return byHour.value[i] ? hours.value[i] : undefined
})
</script>

<template>
  <div class="hm">
    <div class="grid" :style="{ gridTemplateColumns: `28px repeat(${hours.length}, minmax(0, 1fr))` }">
      <template v-for="(row, d) in matrix" :key="d">
        <span class="wd" :class="{ off: d >= 5 }">{{ WD[d] }}</span>
        <i v-for="h in hours" :key="h" class="c" :style="{ '--a': row[h] ? 0.12 + (row[h] / max) * 0.88 : 0 }" :title="`${WD[d]} ${h}:00–${h + 1}:00 — ${row[h] ? formatDuration(row[h]) : 'ничего'}`"></i>
      </template>
      <span></span>
      <span v-for="h in hours" :key="`h${h}`" class="hl">{{ h % 2 === 0 ? h : '' }}</span>
    </div>
    <div class="prof" :style="{ gridTemplateColumns: `28px repeat(${hours.length}, minmax(0, 1fr))` }">
      <span class="pk">{{ peak !== undefined ? `пик ${peak}ч` : '' }}</span>
      <i v-for="(v, i) in byHour" :key="i" :title="`${hours[i]}:00 — ${formatDuration(v)}`"><b :style="{ height: `${(v / maxHour) * 100}%` }"></b></i>
    </div>
  </div>
</template>

<style scoped>
.hm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.grid,
.prof {
  display: grid;
  gap: 2px;
  align-items: center;
}
.wd {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
}
.wd.off {
  color: var(--down-fg);
}
.c {
  height: 18px;
  border-radius: 2px;
  background: rgb(var(--accent-rgb) / var(--a));
  outline: 1px solid var(--border);
  outline-offset: -1px;
}
.hl {
  color: var(--dim);
  font-family: var(--font-data);
  font-size: 10px;
  text-align: center;
}
.prof {
  height: 46px;
  align-items: end;
}
.prof i {
  position: relative;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.prof b {
  width: 100%;
  min-height: 1px;
  border-radius: 2px 2px 0 0;
  background: var(--cyan);
  opacity: 0.75;
}
.pk {
  align-self: center;
  color: var(--cyan);
  font-family: var(--font-data);
  font-size: 10px;
}
</style>
