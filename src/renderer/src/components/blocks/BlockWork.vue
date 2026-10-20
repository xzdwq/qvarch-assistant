<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { parseWork, workMd, workRange, workReport, WORK_PERIODS, type WorkModel, type WorkPeriod, type WorkReport } from '@shared/noteBlocks'
import { isProductive } from '@shared/kinds'
import type { KindDef } from '@shared/types'
import DateRangePicker from '../DateRangePicker.vue'
import Icon from '../Icon.vue'

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
  <div class="wk">
    <div class="wk-h">
      <span class="wk-k"><Icon name="briefcase" :size="14" />Работа</span>
      <span class="wk-nav" title="Колесо мыши — на день / период вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib" title="Назад" @mousedown.prevent @click="shift(-1)"><Icon name="chevronLeft" :size="13" /></button>
        <button ref="pickEl" class="wk-p" :class="{ on: pickOpen }" title="Выбрать день или период" @mousedown.prevent @click="pickOpen = !pickOpen"><Icon name="calendar" :size="12" />{{ periodText }}</button>
        <button class="ib" title="Вперёд" @mousedown.prevent @click="shift(1)"><Icon name="chevronRight" :size="13" /></button>
        <button v-if="!hasToday" class="wk-today" title="К сегодняшнему: сегодня, эта неделя или этот месяц" @mousedown.prevent @click="goToday">Сегодня</button>
      </span>
      <DateRangePicker v-if="pickOpen" :from="range.from" :to="range.to" :anchor="pickEl" @apply="(a, b) => ((pickOpen = false), setDates(a, b))" @close="pickOpen = false" />
      <span v-if="report" class="wk-sum">{{ dur(report.total) }}</span>
      <span class="grow"></span>
      <span class="wk-view">
        <button :class="{ on: m.view === 'table' }" @mousedown.prevent @click="((m.view = 'table'), save())"><Icon name="table" :size="12" />Таблица</button>
        <button :class="{ on: m.view === 'list' }" @mousedown.prevent @click="((m.view = 'list'), save())"><Icon name="list" :size="12" />Список</button>
      </span>
    </div>
    <div v-if="kindCounts.length > 1 || hidden.size" class="wk-kinds">
      <button
        v-for="[k, n] in kindCounts"
        :key="k"
        class="wk-kc"
        :class="{ off: hidden.has(k) }"
        :style="{ '--c': kindOf(k)?.color ?? 'var(--muted)' }"
        :title="hidden.has(k) ? 'Показать' : 'Скрыть'"
        @mousedown.prevent
        @click="toggleKind(k)"
      ><i></i>{{ kindOf(k)?.label ?? k }} <small>{{ n }}</small></button>
    </div>

    <p v-if="!report && loading" class="wk-empty">Считаю…</p>
    <p v-else-if="report && !report.days.length" class="wk-empty">За этот период работы нет.</p>
    <template v-else-if="report">
      <!-- a table -->
      <table v-if="m.view === 'table'" class="wk-t">
        <thead>
          <tr>
            <th class="c-kind">Тип</th>
            <th>Название</th>
            <th v-if="multi" class="c-day">Дата</th>
            <th class="c-time">Время</th>
            <th class="c-dur">Длительность</th>
          </tr>
        </thead>
        <tbody v-for="d in report.days" :key="d.day">
          <tr v-if="multi" class="wk-day">
            <td :colspan="5"><span class="dn">{{ dayTitle(d.day) }}</span><span class="dt">{{ dur(d.total) }}</span></td>
          </tr>
          <tr v-for="it in d.items" :key="it.id" class="wk-row" title="Открыть на таймлайне" @click="open(d.day, it.id)">
            <td class="c-kind">
              <span class="ki" :style="{ color: kindOf(it.kind)?.color, background: `color-mix(in srgb, ${kindOf(it.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(it.kind)?.icon ?? 'tag'" :size="12" /></span>
              <span class="kl">{{ kindOf(it.kind)?.label ?? it.kind }}</span>
            </td>
            <td class="c-name"><span>{{ it.label }}</span><code v-if="it.task">{{ it.task }}</code></td>
            <td v-if="multi" class="c-day">{{ shortDay(d.day) }}</td>
            <td class="c-time">{{ hm(it.start) }}–{{ hm(it.end) }}</td>
            <td class="c-dur">{{ dur(it.end - it.start) }}</td>
          </tr>
        </tbody>
      </table>
      <!-- a list -->
      <div v-else class="wk-l">
        <section v-for="d in report.days" :key="d.day">
          <div v-if="multi" class="wk-day l"><span class="dn">{{ dayTitle(d.day) }}</span><span class="dt">{{ dur(d.total) }}</span></div>
          <div v-for="it in d.items" :key="it.id" class="wk-li" title="Открыть на таймлайне" @click="open(d.day, it.id)">
            <span class="ki" :style="{ color: kindOf(it.kind)?.color, background: `color-mix(in srgb, ${kindOf(it.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(it.kind)?.icon ?? 'tag'" :size="12" /></span>
            <span class="lt">{{ it.label }}<code v-if="it.task">{{ it.task }}</code></span>
            <span class="lm">{{ kindOf(it.kind)?.label ?? it.kind }} · {{ hm(it.start) }}–{{ hm(it.end) }}</span>
            <b class="ld">{{ dur(it.end - it.start) }}</b>
          </div>
        </section>
      </div>
      <!-- the totals -->
      <div class="wk-tot">
        <div class="cap">Итого по типам</div>
        <div v-for="k in report.byKind" :key="k.kind" class="wk-kt">
          <span class="ki" :style="{ color: kindOf(k.kind)?.color, background: `color-mix(in srgb, ${kindOf(k.kind)?.color ?? 'var(--muted)'} 16%, transparent)` }"><Icon :name="kindOf(k.kind)?.icon ?? 'tag'" :size="12" /></span>
          <span class="kn">{{ kindOf(k.kind)?.label ?? k.kind }}<em>{{ k.count }}</em></span>
          <span class="bar"><i :style="{ width: `${(k.ms / maxKind) * 100}%`, background: kindOf(k.kind)?.color ?? 'var(--accent)' }"></i></span>
          <b>{{ dur(k.ms) }}</b>
        </div>
        <div class="wk-all"><span>Всего</span><b>{{ dur(report.total) }}</b></div>
        <p class="note">Параллельные события считаются один раз — поэтому «всего» может быть меньше суммы по типам.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wk-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.wk-nav .ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}
.wk-nav .ib:hover {
  background: var(--hover);
  color: var(--text);
}
.wk-nav .wk-p {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}
.wk-nav .wk-p.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.wk-today {
  height: 26px;
  margin-left: 4px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: transparent;
  color: var(--accent-fg);
  font-size: 12px;
}
.wk-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 2px 0 8px;
}
.wk-kc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--border-2);
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.wk-kc i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c);
}
.wk-kc small {
  color: var(--muted);
}
.wk-kc.off {
  opacity: 0.45;
  text-decoration: line-through;
}
.wk {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}
.wk-h {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.wk-k {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.wk-p {
  color: var(--text-hi);
  font-weight: 600;
}
.wk-p::first-letter {
  text-transform: uppercase;
}
.wk-sum {
  padding: 1px 8px;
  border-radius: 10px;
  background: rgb(var(--accent-rgb) / 0.15);
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 12px;
}
.grow {
  flex: 1;
}
.wk-view {
  display: inline-flex;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  overflow: hidden;
}
.wk-view button,
.wk-set {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}
.wk-set {
  border: 1px solid var(--border-2);
  border-radius: 6px;
}
.wk-view button.on,
.wk-set.on {
  background: rgb(var(--accent-rgb) / 0.2);
  color: var(--accent-fg);
}
.wk-setup {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px;
  border-radius: 6px;
  background: var(--bg);
}
.wk-setup > button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
}
.wk-setup > button.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.15);
  color: var(--accent-fg);
}
.wk-setup > .wk-done {
  margin-left: auto;
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}
.wk-dates {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.wk-empty {
  margin: 4px 2px;
  color: var(--muted);
  font-size: 13px;
}
.ki {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
}
/* the table */
.wk-t {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.wk-t th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-2);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.wk-t td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.wk-row {
  cursor: pointer;
}
.wk-row:hover td {
  background: var(--hover);
}
.c-kind {
  width: 1%;
  white-space: nowrap;
}
.c-kind .ki {
  margin-right: 8px;
  vertical-align: middle;
}
.kl {
  color: var(--text-2);
}
.c-name span {
  color: var(--text);
}
.c-name code,
.lt code {
  margin-left: 8px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--panel-3);
  color: var(--text-2);
  font-family: var(--font-data);
  font-size: 0.85em;
}
.c-day,
.c-time,
.c-dur {
  width: 1%;
  color: var(--text-2);
  font-family: var(--font-data);
  white-space: nowrap;
}
.c-dur {
  color: var(--text-hi);
  text-align: right;
}
.wk-day td,
.wk-day.l {
  padding: 10px 8px 6px;
  background: transparent;
  border-bottom: 1px solid var(--border-2);
}
.wk-day .dn,
.wk-day.l .dn {
  color: var(--text-hi);
  font-weight: 600;
}
.wk-day .dn::first-letter {
  text-transform: uppercase;
}
.wk-day .dt {
  float: right;
  color: var(--accent-fg);
  font-family: var(--font-data);
  font-size: 12px;
}
.wk-day.l {
  display: flex;
  justify-content: space-between;
}
/* the list */
.wk-l {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wk-li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.wk-li:hover {
  background: var(--hover);
}
.lt {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lm {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.ld {
  min-width: 70px;
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 12.5px;
  font-weight: 500;
  text-align: right;
}
/* the totals */
.wk-tot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--border-2);
}
.cap {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.wk-kt {
  display: grid;
  grid-template-columns: 22px minmax(120px, 220px) minmax(60px, 1fr) 90px;
  align-items: center;
  gap: 10px;
  font-size: 0.92em;
}
.kn {
  color: var(--text);
}
.kn em {
  margin-left: 6px;
  color: var(--muted);
  font-size: 11px;
  font-style: normal;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--panel-3);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
}
.wk-kt b {
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 12.5px;
  font-weight: 500;
  text-align: right;
}
.wk-all {
  display: flex;
  justify-content: space-between;
  padding-top: 6px;
  border-top: 1px dashed var(--border-2);
  color: var(--text-hi);
  font-weight: 600;
}
.wk-all b {
  color: var(--accent-fg);
  font-family: var(--font-data);
}
.note {
  margin: 0;
  color: var(--dim);
  font-size: 11px;
}
</style>
