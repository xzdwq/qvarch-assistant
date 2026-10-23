<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { parseWork, workMd, workRange, workReport, WORK_PERIODS, type WorkModel, type WorkPeriod, type WorkReport } from './model'
import { isProductive } from '@shared/kinds'
import type { KindDef } from '@shared/types'
import DateRangePicker from '@renderer/components/DateRangePicker.vue'
import Icon from '@renderer/components/Icon.vue'

/**
 * «Работа»: the productive events of a period (today, a week, a month, own dates) — as a table or a list,
 * by days, each with its kind, title, task, time and length; then the hours per kind and the total
 * (parallel events counted once). A relative period («эта неделя») moves with the calendar.
 */
const props = defineProps<{ src: string; autofocus?: boolean }>()
const emit = defineEmits<{ change: [src: string] }>()
const m = ref<WorkModel>(parseWork(props.src))
let mine = props.src
watch(
  () => props.src,
  (s) => {
    if (s === mine) return
    mine = s
    m.value = parseWork(s)
  },
)
function save(): void {
  const md = workMd(m.value)
  if (md === mine) return
  mine = md
  emit('change', md)
}
const range = computed(() => workRange(m.value, new Date(now.value)))

// ---------- the period: ‹ dates ›, the wheel, «Сегодня» (as in Моя работа) ----------
const pickOpen = ref(false)
const pickEl = ref<HTMLElement>()
const shiftDay = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`)
  x.setDate(x.getDate() + n)
  return x.toLocaleDateString('sv-SE')
}
const monthEnd = (d: string) => shiftDay(`${shiftDay(`${d.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1)
const spanDays = () => Math.round((new Date(`${range.value.to}T12:00:00`).getTime() - new Date(`${range.value.from}T12:00:00`).getTime()) / 86_400_000) + 1
const wholeMonth = () => range.value.from.endsWith('-01') && range.value.to === monthEnd(range.value.from)
function setDates(from: string, to: string): void {
  m.value.period = 'custom'
  m.value.from = from
  m.value.to = to
  save()
}
function shift(dir: 1 | -1): void {
  const r = range.value
  if (wholeMonth()) {
    const x = new Date(`${r.from}T12:00:00`)
    x.setMonth(x.getMonth() + dir)
    const a = `${x.toLocaleDateString('sv-SE').slice(0, 7)}-01`
    return setDates(a, monthEnd(a))
  }
  const n = spanDays() * dir
  setDates(shiftDay(r.from, n), shiftDay(r.to, n))
}
let wheelAt = 0
function onWheel(e: WheelEvent): void {
  if (!e.deltaY || performance.now() - wheelAt < 90) return
  wheelAt = performance.now()
  shift(e.deltaY < 0 ? 1 : -1)
}
const today = () => new Date().toLocaleDateString('sv-SE')
const hasToday = computed(() => range.value.from <= today() && today() <= range.value.to)
/** «Сегодня»: the living period of that kind — today, this week, this month (it moves with the calendar). */
function goToday(): void {
  const n = spanDays()
  const p: WorkPeriod | undefined = wholeMonth() ? 'this-month' : n === 7 && new Date(`${range.value.from}T12:00:00`).getDay() === 1 ? 'this-week' : n === 1 ? 'today' : undefined
  if (p) {
    m.value.period = p
    m.value.from = m.value.to = undefined
    save()
  } else setDates(shiftDay(today(), -(n - 1)), today())
}
// ---------- the kinds shown ----------
const hidden = computed(() => new Set(m.value.hide ?? []))
function toggleKind(k: string): void {
  const h = new Set(hidden.value)
  if (h.has(k)) h.delete(k)
  else h.add(k)
  m.value.hide = [...h]
  save()
}

// ---------- the data ----------
const kinds = shallowRef<KindDef[]>([])
void window.qa.getSettings().then((s) => (kinds.value = s.kinds))
const offSettings = window.qa.onSettings((s) => (kinds.value = s.kinds))
const report = shallowRef<WorkReport>()
/** The kinds of the period (before hiding), how many of each. */
const kindCounts = shallowRef<Array<[string, number]>>([])
const loading = ref(false)
const now = ref(Date.now())
let seq = 0
async function load(): Promise<void> {
  const my = ++seq
  loading.value = true
  try {
    const days = await window.qa.rangeDays(range.value.from, range.value.to)
    if (my !== seq) return
    const counts = new Map<string, number>()
    for (const d of days) for (const e of d.entries) if (isProductive(kinds.value, e.kind)) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
    kindCounts.value = [...counts].sort((a, b) => b[1] - a[1])
    report.value = workReport(
      days.map((d) => ({ day: d.day, entries: d.entries.filter((e) => !hidden.value.has(e.kind)).map((e) => ({ id: e.id, kind: e.kind, label: e.label, task: e.task ? `${e.task.key}` : undefined, start: e.start, end: e.end })) })),
      (k) => isProductive(kinds.value, k),
      Date.now(),
    )
  } finally {
    if (my === seq) loading.value = false
  }
}
watch([() => range.value.from, () => range.value.to, kinds, () => (m.value.hide ?? []).join()], () => void load(), { immediate: true })
// the period holds today: it follows the day (new events, the one going on)
let reloadTimer: ReturnType<typeof setTimeout> | undefined
const offDay = window.qa.onDayState(() => {
  const today = new Date().toLocaleDateString('sv-SE')
  if (today < range.value.from || today > range.value.to) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void load(), 3000)
})
const tick = setInterval(() => (now.value = Date.now()), 60_000)
onBeforeUnmount(() => {
  offDay()
  offSettings()
  clearInterval(tick)
  clearTimeout(reloadTimer)
})

// ---------- how it reads ----------
const kindOf = (id: string) => kinds.value.find((k) => k.id === id)
const hm = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
function dur(ms: number): string {
  const min = Math.round(ms / 60000)
  const h = Math.floor(min / 60)
  return h ? `${h} ч${min % 60 ? ` ${min % 60} мин` : ''}` : `${min} мин`
}
const dayTitle = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '')
const periodText = computed(() => {
  const r = range.value
  const name = WORK_PERIODS.find((p) => p.id === m.value.period)?.title
  const span = r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} – ${shortDay(r.to)}`
  return m.value.period === 'custom' ? span : `${name} · ${span}`
})
const multi = computed(() => (report.value?.days.length ?? 0) > 1 || range.value.from !== range.value.to)
const maxKind = computed(() => Math.max(1, ...(report.value?.byKind.map((k) => k.ms) ?? [1])))
const open = (day: string, id: string) => window.qa.openMain(day, id)
</script>

<template>
  <div class="wk tw:flex tw:flex-col tw:gap-8 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="wk-h tw:flex tw:items-center tw:gap-10 tw:flex-wrap">
      <span class="wk-k tw:inline-flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12px]"><Icon name="briefcase" :size="14" />Работа</span>
      <span class="wk-nav tw:inline-flex tw:items-center tw:gap-2" title="Колесо мыши — на день / период вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Назад" @mousedown.prevent @click="shift(-1)"><Icon name="chevronLeft" :size="13" /></button>
        <button ref="pickEl" class="wk-p tw:inline-flex tw:items-center tw:gap-6 tw:h-26 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-text tw:text-[12.5px] tw:font-semibold tw:whitespace-nowrap tw:[&.on]:border-accent/60 tw:first-letter:uppercase" :class="{ on: pickOpen }" title="Выбрать день или период" @mousedown.prevent @click="pickOpen = !pickOpen"><Icon name="calendar" :size="12" />{{ periodText }}</button>
        <button class="ib tw:inline-flex tw:items-center tw:justify-center tw:w-24 tw:h-26 tw:p-0 tw:border-0 tw:rounded-[6px] tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text" title="Вперёд" @mousedown.prevent @click="shift(1)"><Icon name="chevronRight" :size="13" /></button>
        <button v-if="!hasToday" class="wk-today tw:h-26 tw:ml-4 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[6px] tw:bg-transparent tw:text-accent-fg tw:text-[12px] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3" title="К сегодняшнему: сегодня, эта неделя или этот месяц" @mousedown.prevent @click="goToday">Сегодня</button>
      </span>
      <DateRangePicker v-if="pickOpen" :from="range.from" :to="range.to" :anchor="pickEl" @apply="(a, b) => ((pickOpen = false), setDates(a, b))" @close="pickOpen = false" />
      <span v-if="report" class="wk-sum tw:py-1 tw:px-8 tw:rounded-[10px] tw:bg-accent/15 tw:text-accent-fg tw:font-data tw:text-[12px]">{{ dur(report.total) }}</span>
      <span class="grow tw:flex-1"></span>
      <span class="wk-view tw:inline-flex tw:border tw:border-border-2 tw:rounded-[6px] tw:overflow-hidden">
        <button :class="{ on: m.view === 'table' }" @mousedown.prevent @click="((m.view = 'table'), save())"><Icon name="table" :size="12" />Таблица</button>
        <button :class="{ on: m.view === 'list' }" @mousedown.prevent @click="((m.view = 'list'), save())"><Icon name="list" :size="12" />Список</button>
      </span>
    </div>
    <div v-if="kindCounts.length > 1 || hidden.size" class="wk-kinds tw:flex tw:flex-wrap tw:gap-5 tw:mt-2 tw:mr-0 tw:mb-8 tw:ml-0">
      <button
        v-for="[k, n] in kindCounts"
        :key="k"
        class="wk-kc tw:inline-flex tw:items-center tw:gap-6 tw:h-24 tw:py-0 tw:px-9 tw:border tw:border-border-2 tw:rounded-[12px] tw:bg-transparent tw:text-text-2 tw:text-[12px] tw:[&.off]:opacity-45 tw:[&.off]:line-through tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3"
        :class="{ off: hidden.has(k) }"
        :style="{ '--c': kindOf(k)?.color ?? 'var(--muted)' }"
        :title="hidden.has(k) ? 'Показать' : 'Скрыть'"
        @mousedown.prevent
        @click="toggleKind(k)"
      ><i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:[background:var(--c)]"></i>{{ kindOf(k)?.label ?? k }} <small class="tw:text-muted">{{ n }}</small></button>
    </div>

    <p v-if="!report && loading" class="wk-empty tw:my-4 tw:mx-2 tw:text-muted tw:text-[13px]">Считаю…</p>
    <p v-else-if="report && !report.days.length" class="wk-empty tw:my-4 tw:mx-2 tw:text-muted tw:text-[13px]">За этот период работы нет.</p>
    <template v-else-if="report">
      <!-- a table -->
      <table v-if="m.view === 'table'" class="wk-t tw:w-full tw:border-collapse tw:text-[0.9em]">
        <thead>
          <tr>
            <th class="c-kind tw:py-6 tw:px-8 tw:border-b tw:border-b-border-2 tw:text-muted tw:text-[11.5px] tw:font-medium tw:text-left tw:whitespace-nowrap tw:w-[1%]">Тип</th>
            <th class="tw:py-6 tw:px-8 tw:border-b tw:border-b-border-2 tw:text-muted tw:text-[11.5px] tw:font-medium tw:text-left tw:whitespace-nowrap">Название</th>
            <th v-if="multi" class="c-day tw:py-6 tw:px-8 tw:border-b tw:border-b-border-2 tw:text-muted tw:text-[11.5px] tw:font-medium tw:text-left tw:whitespace-nowrap tw:w-[1%] tw:font-data">Дата</th>
            <th class="c-time tw:py-6 tw:px-8 tw:border-b tw:border-b-border-2 tw:text-muted tw:text-[11.5px] tw:font-medium tw:text-left tw:whitespace-nowrap tw:w-[1%] tw:font-data">Время</th>
            <th class="c-dur tw:py-6 tw:px-8 tw:border-b tw:border-b-border-2 tw:text-muted tw:text-[11.5px] tw:font-medium tw:text-left tw:whitespace-nowrap tw:w-[1%] tw:font-data">Длительность</th>
          </tr>
        </thead>
        <tbody v-for="d in report.days" :key="d.day">
          <tr v-if="multi" class="wk-day">
            <td class="tw:align-middle tw:pt-10 tw:pr-8 tw:pb-6 tw:pl-8 tw:bg-transparent tw:border-b tw:border-b-border-2" :colspan="5"><span class="dn tw:text-text-hi tw:font-semibold tw:first-letter:uppercase">{{ dayTitle(d.day) }}</span><span class="dt tw:float-right tw:text-accent-fg tw:font-data tw:text-[12px]">{{ dur(d.total) }}</span></td>
          </tr>
          <tr v-for="it in d.items" :key="it.id" class="wk-row tw:group/wk-row tw:cursor-pointer" title="Открыть на таймлайне" @click="open(d.day, it.id)">
            <td class="c-kind tw:py-6 tw:px-8 tw:border-b tw:border-b-border tw:align-middle tw:group-hover/wk-row:bg-hover tw:w-[1%] tw:whitespace-nowrap">
              <span class="ki tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-[5px] tw:mr-8 tw:align-middle" :style="{ color: kindOf(it.kind)?.color, background: `color-mix(in srgb, ${kindOf(it.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(it.kind)?.icon ?? 'tag'" :size="12" /></span>
              <span class="kl tw:text-text-2">{{ kindOf(it.kind)?.label ?? it.kind }}</span>
            </td>
            <td class="c-name tw:py-6 tw:px-8 tw:border-b tw:border-b-border tw:align-middle tw:group-hover/wk-row:bg-hover"><span class="tw:text-text">{{ it.label }}</span><code class="tw:ml-8 tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-panel-3 tw:text-text-2 tw:font-data tw:text-[0.85em]" v-if="it.task">{{ it.task }}</code></td>
            <td v-if="multi" class="c-day tw:py-6 tw:px-8 tw:border-b tw:border-b-border tw:align-middle tw:group-hover/wk-row:bg-hover tw:w-[1%] tw:text-text-2 tw:font-data tw:whitespace-nowrap">{{ shortDay(d.day) }}</td>
            <td class="c-time tw:py-6 tw:px-8 tw:border-b tw:border-b-border tw:align-middle tw:group-hover/wk-row:bg-hover tw:w-[1%] tw:text-text-2 tw:font-data tw:whitespace-nowrap">{{ hm(it.start) }}–{{ hm(it.end) }}</td>
            <td class="c-dur tw:py-6 tw:px-8 tw:border-b tw:border-b-border tw:align-middle tw:group-hover/wk-row:bg-hover tw:w-[1%] tw:font-data tw:whitespace-nowrap tw:text-text-hi tw:text-right">{{ dur(it.end - it.start) }}</td>
          </tr>
        </tbody>
      </table>
      <!-- a list -->
      <div v-else class="wk-l tw:flex tw:flex-col tw:gap-2">
        <section v-for="d in report.days" :key="d.day">
          <div v-if="multi" class="wk-day l tw:pt-10 tw:pr-8 tw:pb-6 tw:pl-8 tw:bg-transparent tw:border-b tw:border-b-border-2 tw:flex tw:justify-between"><span class="dn tw:text-text-hi tw:font-semibold tw:first-letter:uppercase">{{ dayTitle(d.day) }}</span><span class="dt tw:float-right tw:text-accent-fg tw:font-data tw:text-[12px]">{{ dur(d.total) }}</span></div>
          <div v-for="it in d.items" :key="it.id" class="wk-li tw:grid tw:grid-cols-[22px_minmax(0,1fr)_auto_auto] tw:items-center tw:gap-10 tw:py-5 tw:px-8 tw:rounded-[6px] tw:cursor-pointer tw:hover:bg-hover" title="Открыть на таймлайне" @click="open(d.day, it.id)">
            <span class="ki tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-[5px]" :style="{ color: kindOf(it.kind)?.color, background: `color-mix(in srgb, ${kindOf(it.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(it.kind)?.icon ?? 'tag'" :size="12" /></span>
            <span class="lt tw:overflow-hidden tw:text-text tw:text-ellipsis tw:whitespace-nowrap">{{ it.label }}<code class="tw:ml-8 tw:py-0 tw:px-5 tw:rounded-[4px] tw:bg-panel-3 tw:text-text-2 tw:font-data tw:text-[0.85em]" v-if="it.task">{{ it.task }}</code></span>
            <span class="lm tw:text-muted tw:text-[12px] tw:whitespace-nowrap">{{ kindOf(it.kind)?.label ?? it.kind }} · {{ hm(it.start) }}–{{ hm(it.end) }}</span>
            <b class="ld tw:min-w-70 tw:text-text-hi tw:font-data tw:text-[12.5px] tw:font-medium tw:text-right">{{ dur(it.end - it.start) }}</b>
          </div>
        </section>
      </div>
      <!-- the totals -->
      <div class="wk-tot tw:flex tw:flex-col tw:gap-6 tw:mt-6 tw:pt-10 tw:border-t tw:border-t-border-2">
        <div class="cap tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Итого по типам</div>
        <div v-for="k in report.byKind" :key="k.kind" class="wk-kt tw:grid tw:grid-cols-[22px_minmax(120px,220px)_minmax(60px,1fr)_90px] tw:items-center tw:gap-10 tw:text-[0.92em]">
          <span class="ki tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-[5px]" :style="{ color: kindOf(k.kind)?.color, background: `color-mix(in srgb, ${kindOf(k.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(k.kind)?.icon ?? 'tag'" :size="12" /></span>
          <span class="kn tw:text-text">{{ kindOf(k.kind)?.label ?? k.kind }}<em class="tw:ml-6 tw:text-muted tw:text-[11px] tw:not-italic">{{ k.count }}</em></span>
          <span class="bar tw:h-6 tw:rounded-[3px] tw:bg-panel-3 tw:overflow-hidden"><i class="tw:block tw:h-full tw:rounded-[3px]" :style="{ width: `${(k.ms / maxKind) * 100}%`, background: kindOf(k.kind)?.color ?? 'var(--accent)' }"></i></span>
          <b class="tw:text-text-hi tw:font-data tw:text-[12.5px] tw:font-medium tw:text-right">{{ dur(k.ms) }}</b>
        </div>
        <div class="wk-all tw:flex tw:justify-between tw:pt-6 tw:border-t tw:[border-top-style:dashed] tw:border-t-border-2 tw:text-text-hi tw:font-semibold"><span>Всего</span><b class="tw:text-accent-fg tw:font-data">{{ dur(report.total) }}</b></div>
        <p class="note tw:m-0 tw:text-dim tw:text-[11px]">Параллельные события считаются один раз — поэтому «всего» может быть меньше суммы по типам.</p>
      </div>
    </template>
  </div>
</template>

<style scoped src="./BlockWork.css"></style>
