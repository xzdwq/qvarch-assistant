<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatDuration } from '@shared/timeline'

/** Shares of a whole: a ring with the total inside and a legend with the percentages. */
const props = defineProps<{ parts: Array<{ key: string; label: string; value: number; color: string }> }>()
const emit = defineEmits<{ pick: [key: string] }>()
const R = 54
const C = 2 * Math.PI * R
const total = computed(() => props.parts.reduce((s, p) => s + p.value, 0))
const arcs = computed(() => {
  let off = 0
  return props.parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const len = (p.value / (total.value || 1)) * C
      const a = { ...p, dash: `${Math.max(0, len - 1.5)} ${C}`, off: -off }
      off += len
      return a
    })
})
const hover = ref<string>()
const shown = computed(() => props.parts.find((p) => p.key === hover.value))
</script>

<template>
  <div class="dn">
    <svg viewBox="0 0 140 140" class="ring">
      <circle cx="70" cy="70" :r="R" class="bg" />
      <circle
        v-for="a in arcs"
        :key="a.key"
        cx="70"
        cy="70"
        :r="R"
        class="arc"
        :class="{ on: hover === a.key }"
        :style="{ stroke: a.color }"
        :stroke-dasharray="a.dash"
        :stroke-dashoffset="a.off"
        @mouseenter="hover = a.key"
        @mouseleave="hover = undefined"
        @click="emit('pick', a.key)"
      />
      <text x="70" y="66" class="t1">{{ shown ? `${Math.round((shown.value / (total || 1)) * 100)}%` : formatDuration(total) }}</text>
      <text x="70" y="84" class="t2">{{ shown ? shown.label : 'всего' }}</text>
    </svg>
    <div class="lg">
      <button v-for="p in parts" :key="p.key" class="li" :class="{ on: hover === p.key }" @mouseenter="hover = p.key" @mouseleave="hover = undefined" @click="emit('pick', p.key)">
        <i :style="{ background: p.color }"></i>
        <span class="ll">{{ p.label }}</span>
        <b>{{ formatDuration(p.value) }}</b>
        <span class="lp">{{ Math.round((p.value / (total || 1)) * 100) }}%</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.dn {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.ring {
  flex: none;
  width: 150px;
  height: 150px;
  transform: rotate(-90deg);
}
.ring text {
  transform: rotate(90deg);
  transform-origin: 70px 70px;
  text-anchor: middle;
}
.bg {
  fill: none;
  stroke: var(--panel-3);
  stroke-width: 16;
}
.arc {
  fill: none;
  stroke-width: 16;
  cursor: default;
  transition: stroke-width 0.12s;
}
.arc.on {
  stroke-width: 20;
}
.t1 {
  fill: var(--text-hi);
  font-family: var(--font-data);
  font-size: 15px;
  font-weight: 700;
}
.t2 {
  fill: var(--muted);
  font-size: 10px;
}
.lg {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
  cursor: default;
}
.li.on {
  background: var(--hover);
}
.li i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.ll {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-2);
}
.li b {
  font-family: var(--font-data);
  font-size: 12px;
  color: var(--text-hi);
}
.lp {
  width: 34px;
  text-align: right;
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11px;
}
</style>
