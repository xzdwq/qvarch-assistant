<script setup lang="ts">
import { todayKey } from '../lib/today'
import { computed, ref, watch } from 'vue'
import { formatDuration, formatHM, pad2 } from '@shared/timeline'
import type { DaySummary, SearchHit } from '@shared/types'
import Icon from '../components/Icon.vue'
import { kindColor, kindLabel } from '../lib/palette'

/** History: a month grid of days with time at the PC, labelled share and the kinds of activity. */
const props = defineProps<{ day: string; workDays: number[] }>()
const emit = defineEmits<{ open: [day: string] }>()

/** Full-text search over the whole history (SQLite FTS): blocks, notes and transcripts, tasks, AI summaries, windows. */
const q = ref('')
const hits = ref<SearchHit[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(searchTimer)
  if (!v.trim()) {
    hits.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    hits.value = await window.qa.search(v)
    searching.value = false
  }, 250)
})
const KIND_TITLE: Record<SearchHit['kind'], string> = { entry: 'Блок', note: 'Заметка', plan: 'План', ai: 'AI анализ', window: 'Окно', task: 'Задача' }
const hitGroups = computed(() => {
  const by = new Map<string, SearchHit[]>()
  for (const h of hits.value) by.set(h.day, [...(by.get(h.day) ?? []), h])
  return [...by.entries()]
})
/** «highlights» → <mark>, the rest escaped. */
const snippetHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/«/g, '<mark>').replace(/»/g, '</mark>')
const dayTitle = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })

const month = ref(props.day.slice(0, 7))
watch(
  () => props.day,
  (d) => (month.value = d.slice(0, 7)),
)
const summaries = ref<Map<string, DaySummary>>(new Map())
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    const list = await window.qa.monthSummary(month.value)
    summaries.value = new Map(list.map((s) => [s.day, s]))
  } finally {
    loading.value = false
  }
}
watch(month, () => void load(), { immediate: true })

function shift(delta: number): void {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

const title = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
})

const today = todayKey

/** Weeks Mon..Sun covering the month (days of neighbouring months are blank). */
const weeks = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const days = new Date(y, m, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: Array<string | undefined> = Array.from({ length: lead }, () => undefined)
  for (let d = 1; d <= days; d++) cells.push(`${month.value}-${pad2(d)}`)
  while (cells.length % 7) cells.push(undefined)
  const out: Array<Array<string | undefined>> = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
})

/** Not a work day by the schedule (Saturday/Sunday by default). */
const isOff = (d: string) => !props.workDays.includes(new Date(`${d}T12:00:00`).getDay())

const totals = computed(() => {
  let weekendDays = 0
  let pcOn = 0
  let labelled = 0
  let days = 0
  const byKind = new Map<string, number>()
  for (const s of summaries.value.values()) {
    if (!s.pcOnMs) continue
    days++
    if (isOff(s.day) && s.labelledMs) weekendDays++
    pcOn += s.pcOnMs
    labelled += s.labelledMs
    for (const [k, ms] of Object.entries(s.byKind)) byKind.set(k, (byKind.get(k) ?? 0) + ms)
  }
  return { pcOn, labelled, days, weekendDays, byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]) }
})

function kinds(s: DaySummary): Array<[string, number]> {
  return Object.entries(s.byKind).sort((a, b) => b[1] - a[1])
}

function share(s: DaySummary): number {
  return s.pcOnMs ? Math.min(100, Math.round((s.labelledMs / s.pcOnMs) * 100)) : 0
}
</script>

<template>
  <div class="cal">
    <div class="searchbar">
      <Icon name="list" :size="15" />
      <input v-model="q" placeholder="Поиск по всей истории: блоки, задачи, заметки и расшифровки, AI-анализы, окна…" spellcheck="false" />
      <span v-if="q" class="muted small">{{ searching ? 'ищу…' : `${hits.length} найдено` }}</span>
      <button v-if="q" class="ico" title="Очистить" @click="q = ''"><Icon name="x" :size="14" /></button>
    </div>
    <div v-if="q.trim()" class="results">
      <div v-for="[d, list] in hitGroups" :key="d" class="rday">
        <button class="rdh" @click="emit('open', d)">{{ dayTitle(d) }} <Icon name="chevronRight" :size="13" /></button>
        <div v-for="(h, i) in list" :key="i" class="hit" @click="emit('open', d)">
          <span class="hk" :class="h.kind">{{ KIND_TITLE[h.kind] }}</span>
          <span class="ht">{{ h.kind === 'task' || h.kind === 'ai' ? '' : formatHM(h.at) }}</span>
          <!-- escaped above, only <mark> added -->
          <span class="hs" v-html="snippetHtml(h.snippet)"></span>
        </div>
      </div>
      <p v-if="!searching && !hits.length" class="muted">Ничего не найдено.</p>
    </div>

    <div class="head">
      <button class="ico" title="Предыдущий месяц" @click="shift(-1)"><Icon name="chevronLeft" :size="16" /></button>
      <h2>{{ title }}</h2>
      <button class="ico" title="Следующий месяц" @click="shift(1)"><Icon name="chevronRight" :size="16" /></button>
      <button v-if="month !== today.slice(0, 7)" class="small" @click="month = today.slice(0, 7)">Текущий месяц</button>
      <span class="spacer"></span>
      <div class="sum">
        <span>Дней с работой <b>{{ totals.days }}</b></span>
        <span v-if="totals.weekendDays" class="wk">Работа в выходные <b>{{ totals.weekendDays }}</b></span>
        <span>QA включено <b>{{ formatDuration(totals.pcOn) }}</b></span>
        <span>Размечено <b>{{ formatDuration(totals.labelled) }}</b></span>
        <span v-for="[k, ms] in totals.byKind.slice(0, 5)" :key="k" class="k"><i :style="{ background: kindColor(k) }"></i>{{ kindLabel(k) }} <b>{{ formatDuration(ms) }}</b></span>
      </div>
    </div>

    <div class="grid" :class="{ loading }">
      <div v-for="(d, i) in ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']" :key="d" class="dow" :class="{ off: !workDays.includes((i + 1) % 7) }">{{ d }}</div>
      <template v-for="(w, wi) in weeks" :key="wi">
        <template v-for="(d, di) in w" :key="`${wi}-${di}`">
          <div v-if="!d" class="cell blank"></div>
          <button
            v-else
            class="cell"
            :class="{ today: d === today, weekend: isOff(d), empty: !summaries.get(d)?.pcOnMs, future: d > today, wkwork: isOff(d) && !!summaries.get(d)?.labelledMs }"
            :disabled="d > today"
            @click="emit('open', d)"
          >
            <div class="num">
              {{ Number(d.slice(8)) }}
              <span v-if="isOff(d) && summaries.get(d)?.labelledMs" class="wkbadge">работа в выходной</span>
            </div>
            <template v-if="summaries.get(d)?.pcOnMs">
              <div class="pc">{{ formatDuration(summaries.get(d)!.pcOnMs) }}</div>
              <div class="range muted">
                {{ formatHM(summaries.get(d)!.firstStart!) }}–{{ formatHM(summaries.get(d)!.lastEnd!) }}
              </div>
              <div class="bar" :title="`Размечено ${share(summaries.get(d)!)}%`">
                <span
                  v-for="[k, ms] in kinds(summaries.get(d)!)"
                  :key="k"
                  :style="{ width: `${(ms / summaries.get(d)!.pcOnMs) * 100}%`, background: kindColor(k) }"
                  :title="`${kindLabel(k)}: ${formatDuration(ms)}`"
                ></span>
              </div>
              <div class="share muted">размечено {{ share(summaries.get(d)!) }}%</div>
            </template>
          </button>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cal {
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.searchbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
}
.searchbar input {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 14px;
  outline: none;
}
.results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 55vh;
  overflow: auto;
}
.rdh {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #c7d2fe;
  font-weight: 600;
  font-size: 13px;
  text-transform: capitalize;
}
.hit {
  display: grid;
  grid-template-columns: 78px 44px minmax(0, 1fr);
  gap: 8px;
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
}
.hit:hover {
  background: var(--hover);
}
.hk {
  font-size: 11px;
  color: var(--muted);
}
.hk.note {
  color: #fcd34d;
}
.hk.task {
  color: #86efac;
}
.hk.ai {
  color: #c4b5fd;
}
.ht {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}
.hs {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hs :deep(mark) {
  background: rgba(250, 204, 21, 0.3);
  color: inherit;
  border-radius: 3px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
h2 {
  margin: 0 6px;
  font-size: 18px;
  text-transform: capitalize;
  min-width: 170px;
}
.ico {
  display: inline-flex;
  padding: 5px 7px;
}
.small {
  font-size: 12px;
  padding: 4px 10px;
}
.spacer {
  flex: 1;
}
.sum {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--muted);
}
.sum span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sum b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  transition: opacity 0.2s;
}
.grid.loading {
  opacity: 0.6;
}
.dow {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 4px;
}
.cell {
  min-height: 108px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 8px 10px;
  text-align: left;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  font-size: 12px;
}
.cell:hover:not(:disabled) {
  border-color: #3b3f6b;
  background: var(--panel-2);
}
.cell.blank {
  background: transparent;
  border: 0;
}
.cell.weekend {
  background: linear-gradient(180deg, rgba(244, 63, 94, 0.13), rgba(244, 63, 94, 0.05));
  border-color: rgba(244, 63, 94, 0.22);
}
.cell.weekend .num,
.dow.off {
  color: #fb7185;
}
.cell.weekend:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(244, 63, 94, 0.2), rgba(244, 63, 94, 0.08));
}
.cell.empty .num,
.cell.future .num {
  color: var(--muted);
}
.cell.future {
  opacity: 0.45;
  cursor: default;
}
.cell.wkwork {
  border-color: rgba(251, 191, 36, 0.55);
}
.wkbadge {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  color: #fbbf24;
}
.sum .wk b {
  color: #fbbf24;
}
.cell.today {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.num {
  font-size: 15px;
  font-weight: 700;
}
.pc {
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.range {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  margin-top: auto;
}
.bar span {
  height: 100%;
}
.share {
  font-size: 10px;
}
</style>
