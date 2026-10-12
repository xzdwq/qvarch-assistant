<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { formatDuration, formatHM, sortByStart } from '@shared/timeline'
import type { Ms } from '@shared/types'
import { APP_COLORS, kindColor, kindLabel } from '../lib/palette'
import { useSelection } from '../lib/selection'
import { useDay } from '../lib/useDay'
import Icon from '../components/Icon.vue'
import Markdown from '../components/Markdown.vue'

const props = defineProps<{ day: string }>()
const emit = defineEmits<{ show: [] }>()
const { data, now, isToday } = useDay(toRef(props, 'day'))
const sel = useSelection()

type RowType = 'app' | 'idle' | 'pc' | 'call' | 'entry'
interface Row {
  start: Ms
  end: Ms
  type: RowType
  name: string
  detail?: string
  color: string
}

const TYPES: Array<{ id: RowType; label: string }> = [
  { id: 'app', label: 'Приложения' },
  { id: 'idle', label: 'Простой' },
  { id: 'pc', label: 'QA вкл/выкл' },
  { id: 'call', label: 'Созвоны' },
  { id: 'entry', label: 'Записи' },
]
const enabled = ref<Set<RowType>>(new Set(TYPES.map((t) => t.id)))
const query = ref('')
/** Newest first by default; the choice is remembered. */
const desc = ref(readSort())
function readSort(): boolean {
  try {
    return localStorage.getItem('qa.logSort') !== 'asc'
  } catch {
    return true
  }
}
function toggleSort(): void {
  desc.value = !desc.value
  try {
    localStorage.setItem('qa.logSort', desc.value ? 'desc' : 'asc')
  } catch {
    // storage unavailable — the choice just isn't remembered
  }
}
const aiOpen = ref(true)
const minSec = ref(0)

const rows = computed<Row[]>(() => {
  const d = data.value
  const out: Row[] = []
  const spans = sortByStart(d.spans)
  spans.forEach((s, i) => {
    const end = s.open && isToday.value ? now.value : s.end
    out.push({ start: s.start, end, type: 'pc', name: 'QA включено', color: '#22c55e' })
    const next = spans[i + 1]
    if (next) out.push({ start: s.end, end: next.start, type: 'pc', name: 'QA выключено / сон', color: '#3f3f46' })
  })
  for (const a of d.activity) {
    const idle = a.kind === 'idle' || a.kind === 'locked'
    out.push({
      start: a.start,
      end: a.end,
      type: idle ? 'idle' : 'app',
      name: a.app,
      detail: a.title,
      color: APP_COLORS[a.kind],
    })
  }
  for (const c of d.calls)
    out.push({ start: c.start, end: c.end, type: 'call', name: `Созвон: ${c.app}`, detail: c.source === 'mic' ? 'микрофон занят' : 'статус Teams', color: '#14b8a6' })
  for (const e of d.entries)
    out.push({
      start: e.start,
      end: e.end,
      type: 'entry',
      name: `${kindLabel(e.kind)}: ${e.label}`,
      detail: [e.source === 'ai' ? 'AI' : ''].filter(Boolean).join(' · '),
      color: kindColor(e.kind),
    })
  return out.sort((a, b) => a.start - b.start || a.type.localeCompare(b.type))
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = rows.value.filter(
    (r) =>
      enabled.value.has(r.type) &&
      r.end - r.start >= minSec.value * 1000 &&
      (!q || r.name.toLowerCase().includes(q) || (r.detail ?? '').toLowerCase().includes(q)),
  )
  return desc.value ? list.reverse() : list
})

const total = computed(() => filtered.value.filter((r) => r.type === 'app').reduce((s, r) => s + (r.end - r.start), 0))

function toggle(t: RowType): void {
  const s = new Set(enabled.value)
  if (s.has(t)) s.delete(t)
  else s.add(t)
  enabled.value = s
}

function show(r: Row): void {
  sel.commit({ day: props.day, start: r.start, end: r.end })
  emit('show')
}

function exportCsv(): void {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = ['start;end;seconds;type;name;detail']
  for (const r of filtered.value)
    lines.push([formatHM(r.start), formatHM(r.end), Math.round((r.end - r.start) / 1000), r.type, esc(r.name), esc(r.detail ?? '')].join(';'))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `qvarch-log-${props.day}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="log">
    <div class="filters">
      <input v-model="query" class="search" placeholder="Поиск: приложение, запись…" />
      <button v-for="t in TYPES" :key="t.id" class="chip" :class="{ on: enabled.has(t.id) }" @click="toggle(t.id)">{{ t.label }}</button>
      <select v-model.number="minSec" title="Скрыть короткие события">
        <option :value="0">все</option>
        <option :value="10">≥ 10 с</option>
        <option :value="60">≥ 1 мин</option>
        <option :value="300">≥ 5 мин</option>
      </select>
      <span class="spacer"></span>
      <span class="muted">{{ filtered.length }} событий · в приложениях {{ formatDuration(total) }}</span>
      <button @click="exportCsv">Экспорт CSV</button>
    </div>

    <div v-if="data.ai" class="ai">
      <button class="aihead" @click="aiOpen = !aiOpen">
        <Icon name="sparkles" :size="14" />AI анализ дня
        <span class="muted">{{ formatHM(data.ai.at) }} · {{ data.ai.model }}</span>
        <span class="spacer"></span>
        <Icon :name="aiOpen ? 'chevronDown' : 'chevronRight'" :size="13" />
      </button>
      <Markdown v-if="aiOpen" :text="data.ai.text" />
    </div>

    <div class="table">
      <div class="thead">
        <button class="sortbtn" :title="desc ? 'Сначала новые' : 'Сначала старые'" @click="toggleSort">
          Время <Icon :name="desc ? 'chevronDown' : 'chevronRight'" :size="12" />
        </button><span>Длит.</span><span>Событие</span><span>Подробности</span>
      </div>
      <div v-for="(r, i) in filtered" :key="i" class="tr" :class="r.type" title="Показать на таймлайне" @click="show(r)">
        <span class="time">{{ formatHM(r.start) }}–{{ formatHM(r.end) }}</span>
        <span class="dur">{{ r.end - r.start < 60000 ? `${Math.round((r.end - r.start) / 1000)}с` : formatDuration(r.end - r.start) }}</span>
        <span class="name"><i :style="{ background: r.color }"></i>{{ r.name }}</span>
        <span class="detail">{{ r.detail }}</span>
      </div>
      <p v-if="!filtered.length" class="muted empty">Нет событий под фильтр.</p>
    </div>
  </div>
</template>

<style scoped>
.log {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
  height: 100%;
  min-height: 0;
}
.sortbtn {
  text-transform: uppercase;
  letter-spacing: inherit;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ai {
  flex: none;
  max-height: 40%;
  overflow: auto;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid rgba(139, 92, 246, 0.35);
}
.aihead {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #c4b5fd;
  font-weight: 600;
  cursor: pointer;
}
.aihead .muted {
  font-weight: 400;
  font-size: 12px;
}
.aihead .spacer {
  flex: 1;
}
.filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.search {
  width: 320px;
}
.chip.on {
  background: var(--accent);
}
.spacer {
  flex: 1;
}
.table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 13px;
}
.thead,
.tr {
  display: grid;
  grid-template-columns: 110px 70px minmax(200px, 1.1fr) 2fr;
  gap: 12px;
  padding: 6px 14px;
  align-items: center;
}
.thead {
  position: sticky;
  top: 0;
  background: var(--panel-2);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  z-index: 1;
}
.tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  cursor: pointer;
  content-visibility: auto;
  contain-intrinsic-size: auto 30px;
}
.tr:hover {
  background: var(--hover);
}
.tr.idle,
.tr.pc {
  color: var(--muted);
}
.tr.entry {
  background: rgba(99, 102, 241, 0.06);
}
.time,
.dur {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dur {
  color: var(--muted);
}
.name {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.detail {
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.empty {
  padding: 20px;
}
</style>
