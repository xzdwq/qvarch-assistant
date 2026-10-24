<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatDuration, formatHM } from '@shared/timeline'
import { groupItems, type ReportGroupBy } from '@shared/report'
import { attrDim } from '@shared/tracker/attributes'
import { attrDefs } from '../../lib/attributes'
import { entryIcon, kindColor } from '../../lib/palette'
import Icon from '../../components/Icon.vue'
import NoteLinks from '../../components/NoteLinks.vue'
import AttrChips from '../../components/AttrChips.vue'
import { fmtDay as fmt } from '@shared/tracker/reportPeriod'
import { groupHead } from '@shared/tracker/reportStats'
import { KIND_LOOK, useReports } from './useReportsState'

/** The report's breakdown: groups by kind / task / day / week / an attribute, two levels deep, down to the blocks. */
const emit = defineEmits<{ go: [view: 'day', day?: string, entryId?: string] }>()
const { st, loading, all, items } = useReports()

/** The groupings: the fixed ones, then one per attribute (its letters; its name in the tooltip). */
const GROUPS = computed<Array<{ id: ReportGroupBy; label: string; title?: string }>>(() => [
  { id: 'kind', label: 'Вид' },
  { id: 'task', label: 'Задача' },
  { id: 'day', label: 'День' },
  { id: 'week', label: 'Неделя' },
  ...attrDefs.value.map((a) => ({ id: attrDim(a.id), label: a.short, title: `По атрибуту «${a.name}»` })),
])
const subBy = computed<ReportGroupBy>(() => (st.value.group === 'kind' ? 'task' : 'kind'))
const groups = computed(() => groupItems(items.value, st.value.group))
const maxGroup = computed(() => Math.max(1, ...groups.value.map((g) => g.ms)))
const openKeys = ref(new Set<string>())
function flip(k: string): void {
  const s = new Set(openKeys.value)
  if (s.has(k)) s.delete(k)
  else s.add(k)
  openKeys.value = s
}
watch(() => st.value.group, () => (openKeys.value = new Set()))
const summaryOf = (key: string) => all.value.find((i) => i.e.task?.key === key)?.e.task?.summary ?? ''
const groupName = (key: string, by: ReportGroupBy) => groupHead(key, by, KIND_LOOK, summaryOf, attrDefs.value)
/** Shares of the groups' sum (groups may overlap in time — the shares still add up to 100%). */
const groupSum = computed(() => groups.value.reduce((s, g) => s + g.ms, 0))
const pct = (ms: number) => (groupSum.value ? Math.round((ms / groupSum.value) * 100) : 0)
</script>

<template>
  <section class="card tw:py-10 tw:px-12 tw:rounded-r3 tw:border tw:border-border tw:bg-panel">
    <div class="ch tw:flex tw:items-center tw:gap-8 tw:mb-8">
      <span class="ct tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2">Разбивка</span>
      <span class="sp tw:flex-1"></span>
      <div class="seg sm tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-border">
        <button class="tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi tw:h-22 tw:py-0 tw:px-8 tw:text-[11.5px]" v-for="g in GROUPS" :key="g.id" :class="{ on: st.group === g.id }" :title="g.title" @click="st.group = g.id">{{ g.label }}</button>
      </div>
    </div>
    <!-- the shares in one line -->
    <div v-if="groups.length" class="share tw:flex tw:gap-2 tw:h-8 tw:mb-8 tw:rounded-r2 tw:overflow-hidden">
      <i class="tw:min-w-2" v-for="g in groups.slice(0, 12)" :key="g.key" :style="{ flexGrow: g.ms, background: groupName(g.key, st.group).color }" :title="`${groupName(g.key, st.group).name} — ${formatDuration(g.ms)}`"></i>
    </div>
    <div class="tbl tw:flex tw:flex-col">
      <template v-for="g in groups" :key="g.key">
        <button class="gr tw:group/gr tw:flex tw:items-center tw:gap-8 tw:p-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-white/4 tw:hover:enabled:border-border-3" :class="{ open: openKeys.has(g.key) }" @click="flip(g.key)">
          <Icon name="chevronRight" :size="12" class="tw tw:[&&]:flex-none tw:text-muted tw:[transition:transform_0.15s] tw:group-[.open]/gr:[transform:rotate(90deg)]" />
          <i class="dot tw:flex-none tw:w-9 tw:h-9 tw:rounded-r2" :style="{ background: groupName(g.key, st.group).color }"></i>
          <span class="gn tw:flex-[1_1_200px] tw:min-w-0 tw:flex tw:items-baseline tw:gap-8 tw:overflow-hidden"><b class="tw:flex-none tw:font-semibold tw:whitespace-nowrap">{{ groupName(g.key, st.group).name }}</b><small class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]" v-if="groupName(g.key, st.group).sub">{{ groupName(g.key, st.group).sub }}</small></span>
          <span class="gc tw:flex-none tw:w-28 tw:text-muted tw:text-[11px] tw:text-right tw:tabular-nums tw:font-data tw:max-[760px]:hidden">{{ g.count }}</span>
          <span class="gb tw:flex-[0_1_180px] tw:h-6 tw:rounded-r2 tw:bg-white/5 tw:overflow-hidden tw:max-[760px]:hidden"><i class="tw:block tw:h-full tw:rounded-r2" :style="{ width: `${(g.ms / maxGroup) * 100}%`, background: groupName(g.key, st.group).color }"></i></span>
          <b class="gh tw:flex-none tw:w-64 tw:text-right tw:tabular-nums tw:font-data">{{ formatDuration(g.ms) }}</b>
          <span class="gp tw:flex-none tw:w-36 tw:text-muted tw:text-[11px] tw:text-right tw:tabular-nums tw:font-data">{{ pct(g.ms) }}%</span>
        </button>
        <template v-if="openKeys.has(g.key)">
          <template v-for="s in groupItems(g.items, subBy)" :key="`${g.key}/${s.key}`">
            <button class="gr sub tw:group/gr tw:flex tw:items-center tw:gap-8 tw:p-6 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-left tw:hover:bg-white/4 tw:[&&]:pl-26 tw:text-[12px] tw:hover:enabled:border-border-3" :class="{ open: openKeys.has(`${g.key}/${s.key}`) }" @click="flip(`${g.key}/${s.key}`)">
              <Icon name="chevronRight" :size="11" class="tw tw:[&&]:flex-none tw:text-muted tw:[transition:transform_0.15s] tw:group-[.open]/gr:[transform:rotate(90deg)]" />
              <i class="dot tw:flex-none tw:w-9 tw:h-9 tw:rounded-r2" :style="{ background: groupName(s.key, subBy).color }"></i>
              <span class="gn tw:flex-[1_1_200px] tw:min-w-0 tw:flex tw:items-baseline tw:gap-8 tw:overflow-hidden"><b class="tw:flex-none tw:font-semibold tw:whitespace-nowrap">{{ groupName(s.key, subBy).name }}</b><small class="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-muted tw:text-[11.5px]" v-if="groupName(s.key, subBy).sub">{{ groupName(s.key, subBy).sub }}</small></span>
              <span class="gc tw:flex-none tw:w-28 tw:text-muted tw:text-[11px] tw:text-right tw:tabular-nums tw:font-data tw:max-[760px]:hidden">{{ s.count }}</span>
              <span class="gb tw:flex-[0_1_180px] tw:h-6 tw:rounded-r2 tw:bg-white/5 tw:overflow-hidden tw:max-[760px]:hidden"><i class="tw:block tw:h-full tw:rounded-r2" :style="{ width: `${(s.ms / maxGroup) * 100}%`, background: groupName(s.key, subBy).color }"></i></span>
              <b class="gh tw:flex-none tw:w-64 tw:text-right tw:tabular-nums tw:font-data">{{ formatDuration(s.ms) }}</b>
              <span class="gp tw:flex-none tw:w-36 tw:text-muted tw:text-[11px] tw:text-right tw:tabular-nums tw:font-data">{{ pct(s.ms) }}%</span>
            </button>
            <template v-if="openKeys.has(`${g.key}/${s.key}`)">
              <button v-for="i in [...s.items].sort((a, b) => a.e.start - b.e.start)" :key="i.e.id" class="er tw:flex tw:items-center tw:gap-8 tw:pt-4 tw:pr-6 tw:pb-4 tw:pl-50 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text-2 tw:text-[11.5px] tw:text-left tw:hover:bg-white/4 tw:hover:enabled:border-border-3" @click="emit('go', 'day', i.day, i.e.id)">
                <span class="eic tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-16 tw:rounded-r2 tw:text-text-hi" :style="{ background: kindColor(i.e.kind) }"><Icon :name="entryIcon(i.e)" :size="10" :stroke="2.4" /></span>
                <span class="ed tw:flex-none tw:text-muted tw:tabular-nums tw:font-data tw:w-48">{{ fmt(i.day, { day: 'numeric', month: 'short' }) }}</span>
                <span class="et tw:flex-none tw:text-muted tw:tabular-nums tw:font-data">{{ formatHM(i.e.start) }}–{{ formatHM(i.e.end) }}</span>
                <span class="el tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ i.e.label }}</span>
                <AttrChips :attrs="i.e.attrs" />
                <NoteLinks :id="i.e.id" />
                <span class="eh tw:flex-none tw:text-muted tw:tabular-nums tw:font-data">{{ formatDuration(i.e.end - i.e.start) }}</span>
              </button>
            </template>
          </template>
        </template>
      </template>
      <p v-if="!groups.length" class="none tw:m-8 tw:text-muted tw:text-[12px]">{{ loading ? 'Загрузка…' : 'Нет записей за период' }}</p>
    </div>
  </section>
</template>
