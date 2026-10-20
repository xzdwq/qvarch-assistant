<script setup lang="ts">
import { isProductive } from '@shared/kinds'
import NoteLinks from '../components/NoteLinks.vue'
import { computed, reactive, ref, watch } from 'vue'
import { formatDuration, formatHM, shiftDay } from '@shared/timeline'
import type { Entry, Note, PlanBlock } from '@shared/types'
import Icon from '../components/Icon.vue'
import FilterMenu from '../components/FilterMenu.vue'
import EntryModal from '../components/EntryModal.vue'
import DateRangePicker from '../components/DateRangePicker.vue'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'
import { todayKey } from '../lib/today'
import { mondayOf, useRange } from '../lib/useRange'
import { useNow } from '../lib/useDay'

/**
 * «Моя работа» · Список: everything of a period as one list — blocks, meetings, calls, notes, the day plans —
 * filtered by type, kind, task and text, grouped by day with the day's time. A row opens its day.
 */
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()

type Period = 'today' | 'week' | 'month' | 'd30' | 'custom'
type Kind = 'event' | 'meeting' | 'call' | 'note' | 'plan'
const KEY = 'qa.work.list'
const st = reactive(read())
function read() {
  const d = { period: 'week' as Period, from: '', to: '', types: [] as Kind[], kinds: [] as string[], task: 'any' as 'any' | 'with' | 'without', q: '', desc: true, onlyProd: true }
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return d
  }
}
watch(st, (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    // fine
  }
})

/** The last day of a month (YYYY-MM-DD of any day in it). */
const monthEnd = (d: string) => shiftDay(`${shiftDay(`${d.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1)
// the old presets (Сегодня, Неделя…) become their dates — the period is always dates now
{
  const t = todayKey.value
  const old = st.period as Period
  if (old !== 'custom' || !st.from || !st.to) {
    const r: [string, string] =
      old === 'today' ? [t, t] : old === 'month' ? [`${t.slice(0, 7)}-01`, monthEnd(t)] : old === 'd30' ? [shiftDay(t, -29), t] : old === 'custom' ? [st.from || t, st.to || t] : [mondayOf(t), shiftDay(mondayOf(t), 6)]
    st.from = r[0]
    st.to = r[1]
    st.period = 'custom'
  }
}
const range = computed<[string, string]>(() => [st.from || todayKey.value, st.to || todayKey.value])
const spanDays = () => Math.round((new Date(`${st.to}T12:00:00`).getTime() - new Date(`${st.from}T12:00:00`).getTime()) / 86_400_000) + 1
/** The period is a whole month (the 1st to its last day). */
const wholeMonth = () => st.from.endsWith('-01') && st.to === monthEnd(st.from)
/** ‹ › and the wheel: a day by a day, a month by a month, any range by its length. */
function shift(dir: 1 | -1): void {
  if (wholeMonth()) {
    const d = new Date(`${st.from}T12:00:00`)
    d.setMonth(d.getMonth() + dir)
    const a = d.toLocaleDateString('sv-SE').slice(0, 7) + '-01'
    st.from = a
    st.to = monthEnd(a)
    return
  }
  const n = spanDays() * dir
  st.from = shiftDay(st.from, n)
  st.to = shiftDay(st.to, n)
}
let wheelAt = 0
function onWheel(e: WheelEvent): void {
  if (!e.deltaY || performance.now() - wheelAt < 90) return
  wheelAt = performance.now()
  shift(e.deltaY < 0 ? 1 : -1)
}
const hasToday = computed(() => st.from <= todayKey.value && todayKey.value <= st.to)
/** «Сегодня»: the same kind of period, around today (a day — today, a week — this week, a month — this month). */
function goToday(): void {
  const t = todayKey.value
  const n = spanDays()
  if (wholeMonth()) [st.from, st.to] = [`${t.slice(0, 7)}-01`, monthEnd(t)]
  else if (n === 7 && new Date(`${st.from}T12:00:00`).getDay() === 1) [st.from, st.to] = [mondayOf(t), shiftDay(mondayOf(t), 6)]
  else [st.from, st.to] = [shiftDay(t, -(n - 1)), t]
}
const from = computed(() => range.value[0])
const to = computed(() => range.value[1])
const { days, reload } = useRange(from, to)
/** The event opened in the window. */
const editing = ref<{ day: string; entry: Entry }>()
const now = useNow(5_000)
const isLive = (e: Entry) => e.start <= now.value && e.end >= now.value - 90_000 && (e.source === 'detected' || e.end > now.value)
const TYPES = [
  { id: 'event', label: 'События' },
  { id: 'meeting', label: 'Встречи' },
  { id: 'call', label: 'Созвоны' },
  { id: 'note', label: 'Заметки' },
  { id: 'plan', label: 'План дня' },
]
const kindOpts = computed(() => kinds.value.map((k) => ({ id: k.id, label: k.label, color: k.color })))
const rangeOpen = ref(false)
const rangeEl = ref<HTMLElement>()
const rangeText = computed(() => {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  return from.value === to.value ? f(from.value) : `${f(from.value)} – ${f(to.value)}`
})

type Item =
  | { t: 'entry'; type: Kind; day: string; id: string; at: number; e: Entry }
  | { t: 'note'; type: 'note'; day: string; id: string; at: number; n: Note }
  | { t: 'plan'; type: 'plan'; day: string; id: string; at: number; p: PlanBlock }
const typeOf = (e: Entry): Kind => (e.outlook || e.kind === 'meeting' ? 'meeting' : e.kind === 'call' ? 'call' : 'event')
const items = computed<Item[]>(() => {
  const s = st.q.trim().toLowerCase()
  const out: Item[] = []
  const typeOk = (t: Kind) => !st.types.length || st.types.includes(t)
  const kindOk = (k: string) => (!st.onlyProd || isProductive(kinds.value, k)) && (!st.kinds.length || st.kinds.includes(k))
  const taskOk = (task?: { key: string }) => st.task === 'any' || (st.task === 'with' ? !!task : !task)
  const textOk = (...xs: Array<string | undefined>) => !s || xs.some((x) => x?.toLowerCase().includes(s))
  for (const d of days.value) {
    for (const e of d.entries)
      if (typeOk(typeOf(e)) && kindOk(e.kind) && taskOk(e.task) && textOk(e.label, e.description, e.task?.key, e.task?.summary, kindLabel(e.kind)))
        out.push({ t: 'entry', type: typeOf(e), day: d.day, id: e.id, at: e.start, e })
    if (typeOk('note') && !st.kinds.length && st.task !== 'with') for (const n of d.notes) if (textOk(n.text)) out.push({ t: 'note', type: 'note', day: d.day, id: n.id, at: n.at, n })
    if (typeOk('plan')) for (const p of d.plan) if (!p.doneEntryId && kindOk(p.kind) && taskOk(p.task) && textOk(p.label, p.task?.key, p.task?.summary)) out.push({ t: 'plan', type: 'plan', day: d.day, id: p.id, at: p.start, p })
  }
  return out.sort((a, b) => (st.desc ? b.at - a.at : a.at - b.at))
})
/** Union length (parallel blocks counted once). */
function union(list: Array<{ start: number; end: number }>): number {
  const s = [...list].sort((a, b) => a.start - b.start)
  let sum = 0
  let cs = -Infinity
  let ce = -Infinity
  for (const x of s) {
    if (x.start > ce) {
      if (ce > cs) sum += ce - cs
      cs = x.start
      ce = x.end
    } else ce = Math.max(ce, x.end)
  }
  return sum + (ce > cs ? ce - cs : 0)
}
const groups = computed(() => {
  const map = new Map<string, Item[]>()
  for (const it of items.value) map.set(it.day, [...(map.get(it.day) ?? []), it])
  return [...map].map(([day, list]) => ({
    day,
    list,
    ms: union(list.flatMap((i) => (i.t === 'entry' ? [i.e] : []))),
    title: (() => {
      const s = new Date(`${day}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
      return s.charAt(0).toUpperCase() + s.slice(1)
    })(),
  }))
})
const total = computed(() => groups.value.reduce((s, g) => s + g.ms, 0))
const counts = computed(() => ({ entries: items.value.filter((i) => i.t === 'entry').length, notes: items.value.filter((i) => i.t === 'note').length }))
const anyFilter = computed(() => !!(st.types.length || st.kinds.length || st.task !== 'any' || st.q))
function reset(): void {
  st.types = []
  st.kinds = []
  st.task = 'any'
  st.q = ''
}

/** The list as CSV (Excel opens it: ; separated, UTF-8 with a BOM). */
function exportCsv(): void {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = [['Дата', 'Начало', 'Конец', 'Минут', 'Тип', 'Вид', 'Задача', 'Название', 'Описание'].join(';')]
  for (const it of [...items.value].sort((a, b) => a.at - b.at)) {
    if (it.t === 'note') rows.push([it.day, formatHM(it.n.at), '', '', 'Заметка', '', '', q(it.n.text.split('\n')[0]), q(it.n.text)].join(';'))
    else {
      const x = it.t === 'entry' ? it.e : it.p
      rows.push([it.day, formatHM(x.start), formatHM(x.end), String(Math.round((x.end - x.start) / 60_000)), TYPES.find((t) => t.id === it.type)?.label ?? '', q(kindLabel(x.kind)), x.task?.key ?? '', q(x.label), q(it.t === 'entry' ? (it.e.description ?? '') : '')].join(';'))
    }
  }
  const url = URL.createObjectURL(new Blob([`﻿${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `qvarch-${from.value}_${to.value}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
</script>

<template>
  <div class="wl">
    <div class="bar">
      <span class="pnav" title="Колесо мыши — на день / период вперёд или назад" @wheel.prevent="onWheel">
        <button class="ib" title="Назад" @click="shift(-1)"><Icon name="chevronLeft" :size="14" /></button>
        <button ref="rangeEl" class="pl" :class="{ on: rangeOpen }" title="Выбрать день или период" @click="rangeOpen = !rangeOpen"><Icon name="calendar" :size="12" />{{ rangeText }}</button>
        <button class="ib" title="Вперёд" @click="shift(1)"><Icon name="chevronRight" :size="14" /></button>
        <button v-if="!hasToday" class="today" title="К сегодняшнему дню (тот же вид периода)" @click="goToday">Сегодня</button>
      </span>
      <DateRangePicker v-if="rangeOpen" :from="from" :to="to" :anchor="rangeEl" @apply="(a, b) => ((st.from = a), (st.to = b), (st.period = 'custom'), (rangeOpen = false))" @close="rangeOpen = false" />
      <button class="tog" :class="{ on: st.onlyProd }" title="Только продуктивные виды (без обеда, перерыва…)" @click="st.onlyProd = !st.onlyProd">Продуктивные</button>
      <FilterMenu v-model="st.types" label="Тип" icon="layers" :options="TYPES" />
      <FilterMenu v-model="st.kinds" label="Вид" icon="tag" :options="kindOpts" />
      <span class="seg">
        <button :class="{ on: st.task === 'any' }" @click="st.task = 'any'">Все</button>
        <button :class="{ on: st.task === 'with' }" @click="st.task = 'with'">С задачей</button>
        <button :class="{ on: st.task === 'without' }" @click="st.task = 'without'">Без задачи</button>
      </span>
      <label class="search"><Icon name="search" :size="13" /><input v-model="st.q" placeholder="Текст, DOS-123…" spellcheck="false" /></label>
      <button v-if="anyFilter" class="ghost" title="Сбросить фильтры" @click="reset"><Icon name="x" :size="12" />фильтры</button>
      <span class="grow"></span>
      <button class="ghost" :title="st.desc ? 'Сначала новые' : 'Сначала старые'" @click="st.desc = !st.desc"><Icon name="sort" :size="13" />{{ st.desc ? 'новые' : 'старые' }}</button>
      <button class="ghost" title="Выгрузить список в CSV" @click="exportCsv"><Icon name="download" :size="13" />CSV</button>
    </div>
    <div class="sum cap">
      <span>{{ rangeText }}</span>
      <span>Записей <b>{{ counts.entries }}</b></span>
      <span>Время <b>{{ formatDuration(total) }}</b></span>
      <span v-if="counts.notes">Заметок <b>{{ counts.notes }}</b></span>
    </div>
    <div class="list">
      <section v-for="g in groups" :key="g.day" class="grp">
        <div class="gh">
          <span class="gt" :class="{ today: g.day === todayKey }">{{ g.title }}</span>
          <span class="gm num">{{ g.list.length }} · {{ formatDuration(g.ms) }}</span>
          <button class="lnk" title="Открыть день" @click="emit('openDay', g.day)"><Icon name="timeline" :size="12" /></button>
        </div>
        <template v-for="it in g.list" :key="it.id">
          <div v-if="it.t === 'note'" class="row note" @click="emit('openDay', it.day)">
            <span class="tm num">{{ formatHM(it.n.at) }}</span>
            <span class="kic"><Icon name="note" :size="13" /></span>
            <span class="tt"><span class="ttl">{{ it.n.text.split('\n')[0] || 'Заметка' }}</span><span v-if="it.n.text.includes('\n')" class="sub">{{ it.n.text.split('\n').slice(1).join(' ') }}</span></span>
            <span class="badge nt">заметка</span>
          </div>
          <div v-else-if="it.t === 'plan'" class="row plan" :style="{ '--c': kindColor(it.p.kind) }" @click="emit('openDay', it.day)">
            <span class="tm num">{{ formatHM(it.p.start) }}–{{ formatHM(it.p.end) }}</span>
            <span class="kic"><Icon :name="entryIcon(it.p)" :size="13" /></span>
            <span class="tt"><span class="ttl">{{ it.p.label || kindLabel(it.p.kind) }}</span></span>
            <span v-if="it.p.task" class="tchip">{{ it.p.task.key }}</span>
            <span class="badge pl">план</span>
            <span class="du num">{{ formatDuration(it.p.end - it.p.start) }}</span>
          </div>
          <div v-else class="row" :class="{ live: isLive(it.e) }" :style="{ '--c': kindColor(it.e.kind) }" title="Открыть событие" @click="editing = { day: it.day, entry: it.e }">
            <span class="tm num">{{ formatHM(it.e.start) }}–{{ formatHM(it.e.end) }}</span>
            <span class="kic" :title="kindLabel(it.e.kind)"><Icon :name="entryIcon(it.e)" :size="13" /></span>
            <span class="tt">
              <span class="ttl">{{ it.e.label || kindLabel(it.e.kind) }}</span>
              <span v-if="it.e.description" class="sub">{{ it.e.description.split('\n')[0] }}</span>
            </span>
            <span v-if="isLive(it.e)" class="lv"><i></i>идёт</span>
            <span v-if="it.e.task" class="tchip" :title="it.e.task.summary">{{ it.e.task.key }}</span>
            <NoteLinks :id="it.e.id" />
            <span v-if="it.e.outlook" class="badge">Outlook</span>
            <span class="kl">{{ kindLabel(it.e.kind) }}</span>
            <span class="du num">{{ formatDuration(it.e.end - it.e.start) }}</span>
          </div>
        </template>
      </section>
      <EntryModal v-if="editing" :day="editing.day" :entry="editing.entry" @close="editing = undefined" @changed="reload" />
      <p v-if="!groups.length" class="none">Ничего не найдено{{ anyFilter ? ' — попробуйте сбросить фильтры' : '' }}.</p>
    </div>
  </div>
</template>

<style scoped>
.wl {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 10px 14px 0;
  gap: 8px;
}
.num {
  font-family: var(--font-data);
  font-variant-numeric: tabular-nums;
}
.pnav {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.pnav .ib {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.pnav .ib:hover {
  background: var(--hover);
  color: var(--text);
}
.pnav .pl,
.pnav .today {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: transparent;
  color: var(--text);
  font-family: var(--font-data);
  font-size: 12.5px;
  white-space: nowrap;
}
.pnav .pl.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
}
.pnav .today {
  margin-left: 4px;
  color: var(--accent-fg);
  font-family: inherit;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  white-space: nowrap;
  overflow: hidden;
}
.seg {
  display: inline-flex;
  flex: none;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  overflow: hidden;
}
.seg button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.seg button + button {
  border-left: 1px solid var(--border-2);
}
.seg button.on {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.tog {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.tog.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 220px;
  min-width: 120px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-2);
  border-radius: var(--r2);
  background: var(--field-bg);
  color: var(--muted);
}
.search input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12.5px;
}
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  height: 28px;
  padding: 0 9px;
  font-size: 12px;
  color: var(--text-2);
}
.grow {
  flex: 1;
}
.sum {
  display: flex;
  gap: 18px;
  flex: none;
  padding: 2px 2px 0;
}
.sum b {
  color: var(--text-hi);
  font-size: 12px;
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 14px;
}
.grp {
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--panel);
}
.gh {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border);
  border-radius: var(--r3) var(--r3) 0 0;
  background: var(--panel-2);
}
.gt {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-hi);
}
.gt.today {
  color: var(--accent-fg);
}
.gm {
  color: var(--muted);
  font-size: 11.5px;
}
.lnk {
  display: inline-flex;
  margin-left: auto;
  padding: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.lnk:hover {
  color: var(--accent-fg);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  margin: 0 6px;
  padding: 3px 8px 3px 6px;
  border-left: 3px solid var(--c, var(--border-3));
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  cursor: default;
}
.row:last-child {
  border-bottom: 0;
}
.row:hover {
  background: var(--hover);
}
.row.plan {
  border-left-style: dashed;
}
.row.note {
  --c: var(--warn);
}
.tm {
  flex: none;
  width: 92px;
  color: var(--text-2);
  font-size: 12px;
}
.kic {
  display: inline-flex;
  flex: none;
  color: var(--c);
}
.tt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ttl {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}
.sub {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 11.5px;
}
.tchip {
  flex: none;
  padding: 0 7px;
  border-radius: var(--r2);
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
  font-family: var(--font-data);
  font-size: 11px;
}
.badge {
  flex: none;
  padding: 0 6px;
  border-radius: var(--r2);
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
  font-size: 10.5px;
}
.badge.pl {
  background: var(--accent-soft);
  color: var(--accent-fg);
}
.badge.nt {
  background: rgba(255, 183, 77, 0.14);
  color: var(--warn-fg);
}
.kl {
  flex: none;
  width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
  font-size: 11.5px;
  text-align: right;
}
.du {
  flex: none;
  min-width: 52px;
  text-align: right;
  color: var(--text-2);
  font-size: 12px;
}
.none {
  color: var(--muted);
  font-size: 12.5px;
}

/* an event going on now (a call the tracker keeps extending, a block over "now"): a sweep and a pulse */
.row.live {
  position: relative;
  overflow: hidden;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%);
}
.row.live::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 35%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--c) 22%, transparent), transparent);
  animation: live-sweep 2.6s linear infinite;
  pointer-events: none;
}
.row.live .kic {
  animation: live-pulse 1.4s ease-in-out infinite;
}
.lv {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 7px;
  border-radius: var(--r2);
  background: color-mix(in srgb, var(--c) 20%, transparent);
  color: var(--text-hi);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.lv i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 6px var(--c);
  animation: live-blink 1s steps(2) infinite;
}
@keyframes live-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
@keyframes live-pulse {
  50% {
    opacity: 0.45;
    transform: scale(0.88);
  }
}
@keyframes live-blink {
  50% {
    opacity: 0.3;
  }
}
</style>
