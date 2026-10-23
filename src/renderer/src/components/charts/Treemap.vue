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
  <div ref="el" class="tm tw:relative tw:w-full tw:overflow-hidden" :style="{ height: `${height}px` }">
    <button
      v-for="t in tiles"
      :key="t.i"
      class="tile tw:absolute tw:flex tw:flex-col tw:items-start tw:justify-start tw:gap-2 tw:py-6 tw:px-8 tw:overflow-hidden tw:border tw:border-[color-mix(in_srgb,var(--c)_55%,transparent)] tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_24%,var(--panel))] tw:text-text-hi tw:text-left tw:cursor-default tw:hover:bg-[color-mix(in_srgb,var(--c)_38%,var(--panel))] tw:hover:enabled:border-border-3"
      :style="{ left: `${t.x}px`, top: `${t.y}px`, width: `${Math.max(0, t.w - GAP)}px`, height: `${Math.max(0, t.h - GAP)}px`, '--c': items[t.i].color }"
      :title="items[t.i].title ?? `${items[t.i].label} — ${items[t.i].text}`"
      @click="emit('pick', t.i)"
    >
      <template v-if="t.w > 64 && t.h > 40">
        <span class="tl tw:max-w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-[12px] tw:font-semibold">{{ items[t.i].label }}</span>
        <span v-if="t.h > 66 && items[t.i].sub" class="ts tw:max-w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-text-2 tw:text-[11px]">{{ items[t.i].sub }}</span>
        <span class="tv tw:mt-auto tw:font-data tw:text-[12px]">{{ items[t.i].text }} <small class="tw:text-text-2 tw:text-[10.5px]">{{ Math.round((items[t.i].value / total) * 100) }}%</small></span>
      </template>
    </button>
    <p v-if="!tiles.length" class="none tw:text-muted tw:text-[12px]">Нет данных</p>
  </div>
</template>
