<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../../components/Icon.vue'
import FilterMenu from '../../components/FilterMenu.vue'
import Popover from '../../components/Popover.vue'
import DateRangePicker from '../../components/DateRangePicker.vue'
import { kindLabel, kinds } from '../../lib/palette'
import { PERIODS } from '@shared/tracker/reportPeriod'
import { reportCsv } from '@shared/tracker/reportStats'
import { ENTRY_ORIGINS, ORIGIN_LOOK, TASK_TYPE_LOOK, TASK_TYPES } from '@shared/tracker/constants'
import { todayDay as today, useReports } from './useReportsState'
import { NO_VALUE, NO_VALUE_LABEL } from '@shared/tracker/attributes'
import { attrDefs } from '../../lib/attributes'
import { useSavedViews } from './useSavedViews'

/** The report's bar: the period and its arrows, filters, saved views, export and reload. */
const { st, range, shift, isCurrent, label: periodLabel, customLabel, loading, load, all, items, filterField, fKinds, attrField } = useReports()

/** The wheel over the dates: a period forward (up) / back (down) — one step per notch, a touchpad not racing. */
let wheelAt = 0
function onWheel(e: WheelEvent): void {
  if (!e.deltaY || performance.now() - wheelAt < 90) return
  wheelAt = performance.now()
  shift(e.deltaY < 0 ? 1 : -1)
}
const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()

// ---------- filters ----------
const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
const taskOpts = computed(() => {
  const m = new Map<string, string>()
  for (const i of all.value) if (i.e.task) m.set(i.e.task.key, i.e.task.summary)
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([id, s]) => ({ id, label: id, hint: s }))
})
const TYPE_OPTS = TASK_TYPES.map((id) => ({ id, ...TASK_TYPE_LOOK[id] }))
const SOURCE_OPTS = ENTRY_ORIGINS.map((id) => ({ id, ...ORIGIN_LOOK[id] }))
const fTasks = filterField('tasks')
const fType = filterField('taskType')
const fSource = filterField('sources')
/** A filter per attribute: its values and «без значения». */
const attrFilters = computed(() =>
  attrDefs.value.map((a) => ({ def: a, model: attrField(a.id), options: [...a.options.map((o) => ({ id: o.id, label: o.label, color: a.color })), { id: NO_VALUE, label: NO_VALUE_LABEL }] })),
)
const anyFilter = computed(() => {
  const x = st.value.filter
  return !!(x.kinds?.length || x.tasks?.length || x.taskType?.length || x.sources?.length || x.text?.trim() || Object.values(x.attrs ?? {}).some((v) => v.length))
})

const savedEl = ref<HTMLElement>()
const { saved, open: savedOpen, newName, saveView, applyView } = useSavedViews(st)

/** The shown items as a CSV file download. */
function exportCsv(): void {
  const blob = new Blob([reportCsv(items.value, kindLabel, attrDefs.value)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `qvarch-${range.value[0]}_${range.value[1]}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
</script>

<template>
  <div class="bar tw:flex-none tw:flex tw:flex-wrap tw:items-center tw:gap-y-6 tw:gap-x-10 tw:py-8 tw:px-12 tw:border-b tw:border-b-border">
    <div class="seg tw:inline-flex tw:p-2 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-border">
      <button class="tw:h-24 tw:py-0 tw:px-9 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:hover:not-[&.on]:text-text tw:[&.on]:bg-accent/25 tw:[&.on]:text-text-hi" v-for="p in PERIODS" :key="p.id" :class="{ on: st.period === p.id }" @click="st.period = p.id">{{ p.label }}</button>
    </div>
    <div class="nav tw:inline-flex tw:items-center tw:gap-4" title="Колесо мыши — на период вперёд или назад" @wheel.prevent="onWheel">
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
      <span v-if="st.period !== 'custom'" class="pl tw:min-w-110 tw:text-center tw:text-[13px] tw:font-semibold tw:whitespace-nowrap">{{ periodLabel }}</span>
      <button v-else ref="rangeEl" class="rng tw:inline-flex tw:items-center tw:gap-6 tw:h-28 tw:py-0 tw:px-10 tw:border tw:border-border tw:rounded-[4px] tw:bg-transparent tw:text-text tw:text-[12.5px] tw:whitespace-nowrap tw:hover:not-[&.on]:bg-white/6 tw:[&.on]:bg-white/6 tw:hover:enabled:border-border-3" :class="{ on: rangeOpen }" title="Выбрать период" @click="rangeOpen = !rangeOpen">
        <Icon name="calendar" :size="12" />{{ customLabel }}
      </button>
      <DateRangePicker v-if="rangeOpen" :from="range[0]" :to="range[1]" :anchor="rangeEl" @apply="(a, b) => ((st.from = a), (st.to = b), (rangeOpen = false))" @close="rangeOpen = false" />
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
      <button v-if="!isCurrent && st.period !== 'custom'" class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Сейчас" @click="st.anchor = today()"><Icon name="clock" :size="13" /></button>
    </div>
    <span class="sp tw:flex-1"></span>
    <div class="filters tw:inline-flex tw:items-center tw:gap-5 tw:flex-wrap">
      <button class="tog tw:inline-flex tw:items-center tw:h-28 tw:py-0 tw:px-10 tw:rounded-r2 tw:border tw:border-border tw:bg-transparent tw:text-muted tw:text-[12px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3" :class="{ on: st.onlyProd }" title="Только продуктивные виды (без обеда, перерыва…)" @click="st.onlyProd = !st.onlyProd">Продуктивные</button>
      <FilterMenu v-model="fKinds" label="Вид" icon="tag" :options="kindOpts" />
      <FilterMenu v-model="fTasks" label="Задачи" icon="jira" :options="taskOpts" />
      <FilterMenu v-model="fType" label="Тип" icon="checkSquare" :options="TYPE_OPTS" title="Jira / свои / без задачи" />
      <FilterMenu v-model="fSource" label="Источник" icon="outlook" :options="SOURCE_OPTS" />
      <FilterMenu v-for="f in attrFilters" :key="f.def.id" v-model="f.model.value" :label="f.def.short" icon="layers" :options="f.options" :title="`Атрибут «${f.def.name}»`" />
      <label class="srch tw:inline-flex tw:items-center tw:gap-5 tw:h-28 tw:py-0 tw:px-8 tw:border tw:border-border tw:rounded-[4px] tw:text-muted tw:[&.on]:border-accent/60" :class="{ on: st.filter.text }">
        <Icon name="search" :size="13" />
        <input class="tw:w-90 tw:border-0 tw:outline-none tw:bg-transparent tw:text-text tw:text-[12px]" :value="st.filter.text ?? ''" placeholder="Текст" @input="st.filter = { ...st.filter, text: ($event.target as HTMLInputElement).value }" />
      </label>
      <button v-if="anyFilter" class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Сбросить фильтры" @click="st.filter = {}"><Icon name="x" :size="13" /></button>
    </div>
    <div class="acts tw:inline-flex tw:items-center tw:gap-4">
      <div ref="savedEl" class="sv tw:relative">
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:[&.on]:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :class="{ on: savedOpen }" title="Сохранённые отчёты" @click="savedOpen = !savedOpen"><Icon name="star" :size="14" /></button>
        <Popover v-model:open="savedOpen" :anchor="savedEl" :width="230" :chrome="0" class="svd tw:overflow-y-auto tw:p-6 tw:rounded-[4px] tw:border tw:border-white/10 tw:bg-panel-2 tw:[box-shadow:var(--shadow-menu)]">
          <button v-for="v in saved" :key="v.name" class="svi tw:flex tw:items-center tw:gap-7 tw:w-full tw:py-6 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-[12.5px] tw:text-left tw:hover:bg-accent/14 tw:hover:enabled:border-border-3" @click="applyView(v)">
            <Icon name="star" :size="12" />
            <span class="tw:nth-2:flex-1 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap">{{ v.name }}</span>
            <span class="x tw:nth-2:flex-1 tw:nth-2:overflow-hidden tw:nth-2:text-ellipsis tw:nth-2:whitespace-nowrap tw:inline-flex tw:p-2 tw:rounded-r2 tw:text-muted tw:hover:text-down-fg" title="Удалить" @click.stop="saved = saved.filter((x) => x.name !== v.name)"><Icon name="x" :size="11" /></span>
          </button>
          <p v-if="!saved.length" class="none tw:m-8 tw:text-muted tw:text-[12px]">Пока нет</p>
          <form class="svn tw:flex tw:gap-4 tw:mt-6 tw:pt-6 tw:border-t tw:border-t-white/7" @submit.prevent="saveView">
            <input class="tw:flex-1 tw:min-w-0 tw:py-5 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-panel tw:text-text tw:text-[12px]" v-model="newName" placeholder="Сохранить как…" />
            <button class="tw:inline-flex tw:items-center tw:py-0 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-accent/30 tw:text-text-hi tw:disabled:opacity-40" type="submit" :disabled="!newName.trim()"><Icon name="check" :size="13" /></button>
          </form>
        </Popover>
      </div>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" title="Экспорт CSV" :disabled="!items.length" @click="exportCsv"><Icon name="download" :size="14" /></button>
      <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-[4px] tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:disabled:opacity-40 tw:hover:enabled:border-border-3" :class="{ spin: loading }" title="Обновить" @click="load"><Icon name="refresh" :size="14" /></button>
    </div>
  </div>
</template>

<style scoped src="./ReportsBar.css"></style>
