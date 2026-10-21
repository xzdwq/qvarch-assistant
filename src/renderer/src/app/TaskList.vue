<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { priorityRank, type JiraIssue, type JiraListQuery, type TaskRef } from '@shared/jira'
import { formatDuration } from '@shared/timeline'
import Icon from '../components/Icon.vue'
import { formatSec, useJira } from '../lib/jira'
import JiraDetails from '../components/JiraDetails.vue'
import FilterMenu from '../components/FilterMenu.vue'
import EventModal from '../components/EventModal.vue'
import TaskWorked, { type Worked } from '../components/TaskWorked.vue'
import { useJiraFind } from '../lib/jiraFind'

/**
 * Jira: every open task of the projects, by project and due date — page by page as the list is scrolled; the
 * search goes to the main process. My own status (review / done) is set here. The estimate is compared with the
 * time tracked in the app on blocks linked to the task.
 */
const emit = defineEmits<{ settings: []; openDay: [day: string] }>()
const jira = useJira()
const q = ref('')

// ---------- filters and sort (several values of a filter — any of them); remembered ----------
const QUERY_KEY = 'qa.jira.list'
const query = ref<JiraListQuery>(
  (() => {
    try {
      return { sort: 'created', desc: true, ...(JSON.parse(localStorage.getItem(QUERY_KEY) ?? '{}') as JiraListQuery) }
    } catch {
      return { sort: 'created', desc: true }
    }
  })(),
)
watch(
  query,
  (v) => {
    try {
      localStorage.setItem(QUERY_KEY, JSON.stringify(v))
    } catch {
      // fine
    }
  },
  { deep: true },
)
const SORTS: Array<{ id: NonNullable<JiraListQuery['sort']>; label: string }> = [
  { id: 'created', label: 'Дата создания' },
  { id: 'due', label: 'Срок' },
  { id: 'priority', label: 'Приоритет' },
  { id: 'status', label: 'Статус' },
  { id: 'updated', label: 'Обновлено' },
]
const ASSIGNEE = [
  { id: 'mine', label: 'На мне' },
  { id: 'other', label: 'Не на мне' },
]
const DUE = [
  { id: 'late', label: 'Просрочен' },
  { id: 'week', label: 'Ближайшие 7 дней' },
  { id: 'set', label: 'Срок указан' },
  { id: 'none', label: 'Без срока' },
]
/** A filter's list as the menu's model (an empty one — off). */
const fq = <K extends 'statuses' | 'assignee' | 'priorities' | 'due' | 'labels'>(k: K) =>
  computed<string[]>({ get: () => (query.value[k] ?? []) as string[], set: (v) => (query.value = { ...query.value, [k]: v.length ? v : undefined }) })
const fStatus = fq('statuses')
const fAssignee = fq('assignee')
const fPriority = fq('priorities')
const fDue = fq('due')
const fLabels = fq('labels')
const anyFilter = computed(() => !!(query.value.statuses?.length || query.value.assignee?.length || query.value.priorities?.length || query.value.due?.length || query.value.labels?.length))
const resetFilters = () => (query.value = { sort: query.value.sort, desc: query.value.desc })

const { items, total, facets, loading, onScroll, more } = useJiraFind(q, { page: 60, query })
const statusOpts = computed(() => facets.value.statuses.map((x) => ({ id: x, label: x })))
const priorityOpts = computed(() => facets.value.priorities.map((x) => ({ id: x, label: x })))
const labelOpts = computed(() => (facets.value.labels ?? []).map((x) => ({ id: x, label: x })))

// ---------- opened up: one by one, or all at once (the fields and the description, asked for in full) ----------
const openSet = ref(new Set<string>())
/** «Open all»: the pages loaded later open too. */
const allOpen = ref(false)
const isOpen = (k: string) => allOpen.value || openSet.value.has(k)
function toggleOpen(k: string): void {
  if (allOpen.value) {
    // one closed out of «all»: the rest stay open
    allOpen.value = false
    openSet.value = new Set(items.value.map((i) => i.key).filter((x) => x !== k))
    return
  }
  const n = new Set(openSet.value)
  if (n.has(k)) n.delete(k)
  else n.add(k)
  openSet.value = n
}
function toggleAll(): void {
  const on = !(allOpen.value || (openSet.value.size > 0 && items.value.every((i) => openSet.value.has(i.key))))
  allOpen.value = on
  openSet.value = new Set()
}
const anyOpen = computed(() => allOpen.value || openSet.value.size > 0)
const full = ref<Record<string, JiraIssue>>({})
const asking = new Set<string>()
watch(
  () => items.value.filter((i) => isOpen(i.key) && !full.value[i.key]).map((i) => i.key),
  async (keys) => {
    for (const k of keys) {
      if (asking.has(k)) continue
      asking.add(k)
      const it = await window.qa.jiraIssue(k)
      asking.delete(k)
      if (it) full.value = { ...full.value, [k]: it }
    }
  },
)
// a sync brings new fields — asked for again when opened
watch(() => jira.value.syncedAt, () => (full.value = {}))

/** «В работу»: the window of a new event, the task in it — the day and the time are picked there. */
const workTask = ref<TaskRef>()
const prioClass = (i: JiraIssue) => ['', 'p1', 'p2', 'p3', 'p4', 'p5', ''][priorityRank(i)]
const fmtCreated = (t?: number) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '')
/**
 * The list is filled to the bottom of the box: the next pages come by scrolling — but a short list (the projects
 * folded, a first page of one project) has nothing to scroll, so they are asked for at once until it overflows.
 */
const listEl = ref<HTMLElement>()
async function fill(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await nextTick()
    const el = listEl.value
    if (!el || loading.value || items.value.length >= total.value) return
    if (el.scrollHeight - el.clientHeight > 200) return
    await more()
  }
}
const tracked = ref<Record<string, number>>({})

/** Each task's blocks on the timeline (any day, the planned ones too). */
const worked = ref<Record<string, Worked[]>>({})
async function loadTracked(): Promise<void> {
  ;[tracked.value, worked.value] = await Promise.all([window.qa.jiraTracked(), window.qa.jiraWorked()])
}
// the blocks change elsewhere (a new one, one moved) — at most every few seconds
let lastLoad = 0
const offDay = window.qa.onDayState(() => {
  if (Date.now() - lastLoad < 5000) return
  lastLoad = Date.now()
  void loadTracked()
})
onBeforeUnmount(offDay)
onMounted(loadTracked)
watch(() => jira.value.syncedAt, loadTracked)

const isDone = (i: JiraIssue) => i.category === 'done'
/** The loaded page(s), by project (they come sorted by project). */
const groups = computed(() => {
  const out: Array<[string, { name: string; items: JiraIssue[] }]> = []
  for (const i of items.value) {
    const last = out[out.length - 1]
    if (last && last[0] === i.project.key) last[1].items.push(i)
    else out.push([i.project.key, { name: i.project.name || i.project.key, items: [i] }])
  }
  return out
})

/** Projects folded (by key) — remembered. */
const FOLD_KEY = 'qa.jira.folded'
const folded = ref<Set<string>>(
  (() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as string[])
    } catch {
      return new Set<string>()
    }
  })(),
)
function fold(key: string): void {
  const n = new Set(folded.value)
  if (n.has(key)) n.delete(key)
  else n.add(key)
  folded.value = n
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...n]))
  } catch {
    // fine
  }
}
/** All folded / all open (the button over the list). */
const allFolded = computed(() => groups.value.length > 0 && groups.value.every(([k]) => folded.value.has(k)))
function foldAll(): void {
  folded.value = allFolded.value ? new Set() : new Set(groups.value.map(([k]) => k))
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...folded.value]))
  } catch {
    // fine
  }
}

watch([folded, () => items.value.length, loading], () => !loading.value && void fill())

const today = new Date().toISOString().slice(0, 10)
const fmtDue = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
function open(i: JiraIssue): void {
  if (jira.value.siteUrl) openUrl(`${jira.value.siteUrl}/browse/${i.key}`)
}
/** The button turns while a sync goes (at least a moment — a quick one would not be seen). */
const spinning = ref(false)
async function sync(): Promise<void> {
  spinning.value = true
  const t0 = Date.now()
  try {
    await window.qa.jiraSync()
  } finally {
    setTimeout(() => (spinning.value = false), Math.max(0, 700 - (Date.now() - t0)))
  }
}
const hm = (t?: number) => (t ? new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
/** Tracked vs estimate, 0..1+ */
const ratio = (i: JiraIssue) => (i.estimateSec ? (tracked.value[i.key] ?? 0) / 1000 / i.estimateSec : 0)
const syncedText = computed(() => (jira.value.syncedAt ? new Date(jira.value.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'))
</script>

<template>
  <div ref="listEl" class="tasks" @scroll.passive="onScroll">
    <div class="topbar">
      <input v-model="q" class="search" placeholder="Поиск по задачам" spellcheck="false" />
      <template v-if="jira.connected">
        <FilterMenu v-model="fStatus" label="Статус" icon="layers" :options="statusOpts" />
        <FilterMenu v-model="fAssignee" label="Исполнитель" icon="users" :options="ASSIGNEE" />
        <FilterMenu v-model="fPriority" label="Приоритет" icon="flag" :options="priorityOpts" />
        <FilterMenu v-model="fDue" label="Срок" icon="calendar" :options="DUE" />
        <FilterMenu v-model="fLabels" label="Метки" icon="tag" :options="labelOpts" />
        <button v-if="anyFilter" class="ico" title="Сбросить фильтры" @click="resetFilters"><Icon name="x" :size="13" /></button>
        <span class="spacer"></span>
        <span class="sortbox">
          <select v-model="query.sort" title="Сортировка (внутри проекта)">
            <option v-for="o in SORTS" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
          <button class="ico" :title="query.desc !== false ? 'По убыванию · нажмите — по возрастанию' : 'По возрастанию · нажмите — по убыванию'" @click="query.desc = query.desc === false"><Icon :name="query.desc !== false ? 'sortDesc' : 'sortAsc'" :size="14" /></button>
        </span>
      </template>
    </div>

    <div v-if="!jira.connected" class="connect">
      <Icon name="link" :size="22" />
      <p>Jira не подключена. Укажите Client ID и Secret своего приложения Atlassian и войдите — в настройках.</p>
      <button class="primary" @click="emit('settings')">Открыть настройки</button>
    </div>

    <template v-else>
      <div class="bar">
        <span class="muted small">Все незакрытые задачи · {{ total }}<template v-if="items.length < total"> · показано {{ items.length }}</template></span>
        <span class="spacer"></span>
        <span class="muted small" :title="jira.error ? `Последняя попытка ${hm(jira.errorAt)}: ${jira.error}
Задачи — из последней удачной синхронизации (${syncedText}). Следующая попытка — по расписанию или кнопкой.` : ''">
          <template v-if="jira.syncing || spinning">синхронизация…</template>
          <template v-else-if="jira.error">синхр. {{ syncedText }} · <span class="err">{{ hm(jira.errorAt) }} ошибка: {{ jira.error }}</span></template>
          <template v-else>синхр. {{ syncedText }} · каждые 10 мин</template>
        </span>
        <button class="ico" :class="{ on: anyOpen }" :title="anyOpen ? 'Свернуть все задачи' : 'Раскрыть все задачи — описание и поля'" @click="anyOpen ? ((allOpen = false), (openSet = new Set())) : toggleAll()"><Icon :name="anyOpen ? 'collapse' : 'expand'" :size="14" /></button>
        <button v-if="groups.length > 1" class="ico" :title="allFolded ? 'Развернуть все проекты' : 'Свернуть все проекты'" @click="foldAll"><Icon :name="allFolded ? 'chevronDown' : 'collapse'" :size="14" /></button>
        <button class="ico" title="Синхронизировать сейчас" :disabled="jira.syncing || spinning" @click="sync"><Icon name="refresh" :size="14" :class="{ spin: jira.syncing || spinning }" /></button>
      </div>

      <section v-for="[key, g] in groups" :key="key" class="proj" :class="{ folded: folded.has(key) }">
        <h3 :title="folded.has(key) ? 'Развернуть' : 'Свернуть'" @click="fold(key)">
          <Icon name="chevronRight" :size="12" class="fchev" />{{ g.name }} <span class="muted">{{ key }}</span><span class="cnt">{{ g.items.length }}</span>
        </h3>
        <template v-for="i in folded.has(key) ? [] : g.items" :key="i.key">
        <div class="row" :class="{ done: isDone(i), open: isOpen(i.key) }">
          <button class="chev" :title="isOpen(i.key) ? 'Свернуть' : 'Описание и поля'" @click="toggleOpen(i.key)"><Icon name="chevronRight" :size="13" /></button>
          <span class="mine" :title="i.mine ? 'Назначена на вас' : i.assignee ? `Исполнитель: ${i.assignee}` : 'Без исполнителя'"><Icon v-if="i.mine" name="users" :size="13" /></span>
          <a class="key" href="#" :title="`Открыть ${i.key} в Jira`" @click.prevent="open(i)">{{ i.key }}</a>
          <span class="sum" :title="i.summary" @click="toggleOpen(i.key)">
            <span class="sumt">{{ i.summary }}</span>
            <i v-for="c in (i.components ?? []).slice(0, 2)" :key="`c${c}`" class="tg comp">{{ c }}</i>
            <i v-for="l in (i.labels ?? []).slice(0, 3)" :key="`l${l}`" class="tg">{{ l }}</i>
          </span>
          <span class="type muted">{{ i.type }}</span>
          <span class="st" :class="i.category">{{ i.status }}</span>
          <span class="prio" :class="prioClass(i)" :title="i.priority ? `Приоритет: ${i.priority}` : 'Без приоритета'">{{ i.priority ?? '' }}</span>
          <TaskWorked :blocks="worked[i.key] ?? []" />
          <span class="due" :class="{ late: i.due && i.due < today && !isDone(i) }" :title="i.due ? `Срок выполнения ${i.due.split('-').reverse().join('.')}` : 'Без срока'">{{ i.due ? fmtDue(i.due) : '' }}</span>
          <span class="created" :title="i.created ? `Создана ${new Date(i.created).toLocaleString('ru-RU')}` : ''">{{ fmtCreated(i.created) }}</span>
          <span class="est" :title="`Оценка ${formatSec(i.estimateSec)} · размечено в приложении ${formatDuration(tracked[i.key] ?? 0)} · списано в Jira ${formatSec(i.spentSec)}`">
            <span class="nums">{{ formatDuration(tracked[i.key] ?? 0) }} / {{ formatSec(i.estimateSec) }}</span>
            <span v-if="i.estimateSec" class="ebar"><span :class="{ over: ratio(i) > 1 }" :style="{ width: `${Math.min(100, ratio(i) * 100)}%` }"></span></span>
          </span>
          <button class="work" title="В работу — новое событие по задаче (выберите день и время)" @click="workTask = { key: i.key, summary: i.summary }"><Icon name="play" :size="13" /></button>
        </div>
        <JiraDetails v-if="isOpen(i.key)" class="det" :issue="full[i.key] ?? i" />
        </template>
      </section>
      <p v-if="loading" class="muted small">Загрузка…</p>
      <p v-else-if="!groups.length" class="muted">{{ anyFilter ? 'Под фильтры ничего не подходит.' : 'Задач нет.' }}</p>
    </template>
    <EventModal v-if="workTask" text="" :task="workTask" @created="(workTask = undefined), loadTracked()" @close="workTask = undefined" />
  </div>
</template>

<style scoped>
.tasks {
  padding: 12px 14px 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.connect {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px;
  color: var(--muted);
  text-align: center;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.seg button {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--muted);
}
.seg button.on {
  background: rgb(var(--accent-rgb) / 0.25);
  color: var(--text);
}
.search {
  width: 260px;
  padding: 5px 9px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.spacer {
  flex: 1;
}
.small {
  font-size: 12px;
}
.err {
  color: var(--down-fg);
}
.ico {
  display: inline-flex;
  padding: 5px 7px;
}
.proj {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 14px;
}
h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  margin: 2px 0 8px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
.fchev {
  transform: rotate(90deg);
  transition: transform 0.15s;
  color: var(--muted);
}
.proj.folded .fchev {
  transform: none;
}
.proj.folded h3 {
  margin-bottom: 2px;
}
h3 .cnt {
  margin-left: auto;
  padding: 0 7px;
  border-radius: 9px;
  background: var(--hover);
  color: var(--muted);
  font-weight: 400;
}
h3 .muted {
  font-weight: 400;
  font-size: 12px;
}
.row {
  display: grid;
  grid-template-columns: 18px 18px 84px minmax(0, 1fr) 96px 120px 76px 64px 48px 60px 150px 28px;
  align-items: center;
  gap: 10px;
  padding: 5px 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 13px;
}
.row.done {
  opacity: 0.5;
}
.row.open {
  background: var(--panel-2);
}
.chev {
  display: inline-flex;
  padding: 2px;
  border: 0;
  background: transparent;
  color: var(--muted);
  transition: transform 0.12s;
}
.row.open .chev {
  transform: rotate(90deg);
  color: var(--accent-fg);
}
.sum {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  cursor: default;
}
.sumt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tg {
  flex: none;
  padding: 0 6px;
  border-radius: var(--r2);
  background: var(--panel-3);
  color: var(--text-2);
  font-style: normal;
  font-family: var(--font-data);
  font-size: 10.5px;
}
.tg.comp {
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
}
.det {
  margin: 0 0 6px 18px;
  border-left: 2px solid var(--accent);
  background: var(--panel-2);
}
.mine {
  display: inline-flex;
  justify-content: center;
  color: var(--accent-fg);
}
.prio {
  overflow: hidden;
  color: var(--muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prio.p1 {
  color: var(--down-fg);
  font-weight: 700;
}
.prio.p2 {
  color: var(--warn-fg);
  font-weight: 600;
}
.prio.p3 {
  color: var(--text-2);
}
.created {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.work {
  display: inline-flex;
  justify-content: center;
  padding: 4px;
  border: 0;
  border-radius: var(--r2);
  background: transparent;
  color: var(--muted);
}
.work:hover {
  background: rgb(var(--accent-rgb) / 0.18);
  color: var(--accent-fg);
}
.topbar {
  flex-wrap: wrap;
}
.sortbox {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.sortbox select {
  height: 28px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--field-bg);
  color: var(--text);
  font: inherit;
  font-size: 12.5px;
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.ico.on {
  color: var(--accent-fg);
}
.key {
  color: var(--info-fg);
  font-weight: 600;
  text-decoration: none;
}
.key:hover {
  text-decoration: underline;
}
.sum {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st {
  justify-self: start;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: var(--r2);
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(127, 139, 157, 0.18);
  color: var(--text-2);
}
.st.indeterminate {
  background: rgba(68, 138, 255, 0.2);
  color: var(--info-fg);
}
.st.done {
  background: rgba(0, 230, 118, 0.18);
  color: var(--up-fg);
}
.due {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  font-size: 12px;
  color: var(--muted);
}
.due.late {
  color: var(--down-fg);
  font-weight: 700;
}
.est {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.ebar {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.ebar span {
  display: block;
  height: 100%;
  background: var(--up);
}
.ebar span.over {
  background: var(--down);
}
</style>
