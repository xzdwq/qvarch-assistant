<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { treemap } from '@shared/analytics'

/** Where the time went: a rectangle per item, its area = its time (the biggest top-left). */
export interface TreeItem {
  label: string
  sub?: string
  value: number
  text: string
  color: string
  title?: string
}
const props = withDefaults(defineProps<{ items: TreeItem[]; height?: number }>(), { height: 260 })
const emit = defineEmits<{ pick: [i: number] }>()
const el = ref<HTMLElement>()
const width = ref(600)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(() => (width.value = el.value?.clientWidth ?? 600))
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())
const GAP = 2
const tiles = computed(() => treemap(props.items.map((x) => x.value), width.value, props.height))
const total = computed(() => props.items.reduce((s, x) => s + x.value, 0) || 1)
</script>

<template>
  <div ref="el" class="tm" :style="{ height: `${height}px` }">
    <button
      v-for="t in tiles"
      :key="t.i"
      class="tile"
      :style="{ left: `${t.x}px`, top: `${t.y}px`, width: `${Math.max(0, t.w - GAP)}px`, height: `${Math.max(0, t.h - GAP)}px`, '--c': items[t.i].color }"
      :title="items[t.i].title ?? `${items[t.i].label} — ${items[t.i].text}`"
      @click="emit('pick', t.i)"
    >
      <template v-if="t.w > 64 && t.h > 40">
        <span class="tl">{{ items[t.i].label }}</span>
        <span v-if="t.h > 66 && items[t.i].sub" class="ts">{{ items[t.i].sub }}</span>
        <span class="tv">{{ items[t.i].text }} <small>{{ Math.round((items[t.i].value / total) * 100) }}%</small></span>
      </template>
    </button>
    <p v-if="!tiles.length" class="none">Нет данных</p>
  </div>
</template>

<style scoped>
.tm {
  position: relative;
  width: 100%;
  overflow: hidden;
}
.tile {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 2px;
  padding: 6px 8px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--c) 24%, var(--panel));
  color: var(--text-hi);
  text-align: left;
  cursor: default;
}
.tile:hover {
  background: color-mix(in srgb, var(--c) 38%, var(--panel));
}
.tl {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}
.ts {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-size: 11px;
}
.tv {
  margin-top: auto;
  font-family: var(--font-data);
  font-size: 12px;
}
.tv small {
  color: var(--text-2);
  font-size: 10.5px;
}
.none {
  color: var(--muted);
  font-size: 12px;
}
</style>
