<script setup lang="ts">
import { computed } from 'vue'
import { formatDuration } from '@shared/timeline'
import { attrBreakdown } from '@shared/tracker/reportStats'
import { plural } from '@shared/tracker/boardTime'
import { attrDefs } from '../../lib/attributes'
import { useReports } from './useReportsState'

/**
 * The report by attributes: for each attribute — its values over the period (with «Без значения»): time, how many
 * events, the share; a click on a value narrows the report to it (again — lets it go).
 */
const { st, items, attrField } = useReports()
const blocks = computed(() => attrBreakdown(items.value, attrDefs.value))
const pct = (ms: number, total: number) => (total ? Math.round((ms / total) * 100) : 0)
/** A value picked: the report filtered by it (the same one again — the filter off). */
function pick(attrId: string, value: string): void {
  const f = attrField(attrId)
  f.value = f.value.length === 1 && f.value[0] === value ? [] : [value]
}
const isPicked = (attrId: string, value: string) => (st.value.filter.attrs?.[attrId] ?? []).includes(value)
</script>

<template>
  <section v-if="blocks.length" class="card tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel">
    <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8">
      <span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">По атрибутам</span>
    </div>
    <div class="tw:grid tw:grid-cols-[repeat(auto-fill,minmax(300px,1fr))] tw:gap-14">
      <div v-for="b in blocks" :key="b.def.id" class="tw:flex tw:flex-col tw:gap-4 tw:min-w-0">
        <div class="tw:flex tw:items-center tw:gap-6 tw:text-[12.5px] tw:font-semibold">
          <i class="tw:inline-flex tw:items-center tw:h-18 tw:px-5 tw:rounded-r1 tw:not-italic tw:font-data tw:text-[10px] tw:font-bold tw:text-text-hi" :style="{ background: b.def.color }">{{ b.def.short }}</i>
          <span class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ b.def.name }}</span>
        </div>
        <div class="tw:flex tw:gap-2 tw:h-8 tw:rounded-r2 tw:overflow-hidden">
          <i v-for="r in b.rows" :key="r.value" class="tw:min-w-2" :style="{ flexGrow: r.ms, background: r.color }" :title="`${r.label} — ${formatDuration(r.ms)}`"></i>
        </div>
        <button v-for="r in b.rows" :key="r.value" class="tw:flex tw:items-center tw:gap-8 tw:py-3 tw:px-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12px] tw:text-left tw:hover:bg-white/4 tw:[&.on]:bg-accent/14" :class="{ on: isPicked(b.def.id, r.value) }" :title="isPicked(b.def.id, r.value) ? 'Снять фильтр' : `Показать только «${r.label}»`" @click="pick(b.def.id, r.value)">
          <i class="tw:flex-none tw:w-9 tw:h-9 tw:rounded-r2" :style="{ background: r.color }"></i>
          <span class="tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :class="{ 'tw:text-muted': !r.value }">{{ r.label }}</span>
          <span class="tw:flex-none tw:text-muted tw:text-[11px] tw:font-data tw:tabular-nums">{{ r.count }} {{ plural(r.count, 'событие', 'события', 'событий') }}</span>
          <b class="tw:flex-none tw:w-60 tw:text-right tw:font-data tw:tabular-nums">{{ formatDuration(r.ms) }}</b>
          <span class="tw:flex-none tw:w-34 tw:text-right tw:text-muted tw:text-[11px] tw:font-data tw:tabular-nums">{{ pct(r.ms, b.total) }}%</span>
        </button>
      </div>
    </div>
  </section>
</template>
