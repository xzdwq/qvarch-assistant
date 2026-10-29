<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { JIRA_DUE_FILTERS, JIRA_SORTS, type JiraDueFilter, type JiraIssue, type JiraListQuery, type JiraSort, type TaskRef } from '@shared/jira'
import { jiraColumnsOf, type JiraColumn } from '@shared/jiraColumns'
import Icon from '../components/Icon.vue'
import { useJira } from '../lib/jira'
import JiraDetails from '../components/JiraDetails.vue'
import FilterMenu from '../components/FilterMenu.vue'
import EventModal from '../components/EventModal.vue'
import type { Worked } from '../components/TaskWorked.vue'
import { useJiraFind } from '../lib/jiraFind'
import TaskRow from './TaskRow.vue'
import TaskFieldsMenu from './TaskFieldsMenu.vue'

/**
 * Jira: every open task of the projects — a list by project, or the tree of their parents (a solution → its epics →
 * their stories → the tasks), page by page as it is scrolled; the search goes to the main process. The fields shown
 * are picked («Поля»). The estimate is compared with the time tracked in the app on blocks linked to the task.
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
const SORT_LABELS: Record<JiraSort, string> = { created: 'Дата создания', due: 'Срок', priority: 'Приоритет', status: 'Статус', updated: 'Обновлено' }
const SORTS = JIRA_SORTS.map((id) => ({ id, label: SORT_LABELS[id] }))
const ASSIGNEE = [
  { id: 'mine', label: 'На мне' },
  { id: 'other', label: 'Не на мне' },
]
const DUE_LABELS: Record<JiraDueFilter, string> = { late: 'Просрочен', week: 'Ближайшие 7 дней', set: 'Срок указан', none: 'Без срока' }
const DUE = JIRA_DUE_FILTERS.map((id) => ({ id, label: DUE_LABELS[id] }))
/** A filter's list as the menu's model (an empty one — off). */
const fq = <K extends 'statuses' | 'assignee' | 'priorities' | 'due' | 'labels'>(k: K) =>
  computed<string[]>({ get: () => (query.value[k] ?? []) as string[], set: (v) => (query.value = { ...query.value, [k]: v.length ? v : undefined }) })
const fStatus = fq('statuses')
const fAssignee = fq('assignee')
const fPriority = fq('priorities')
const fDue = fq('due')
const fLabels = fq('labels')
/** The tree of parents or the flat list (kept with the filters). */
const tree = computed(() => query.value.view === 'tree')
const toggleView = () => (query.value = { ...query.value, view: tree.value ? 'list' : 'tree' })
/** A task's children hidden / shown in the tree (kept). */
function foldNode(key: string): void {
  const f = new Set(query.value.folded ?? [])
  if (f.has(key)) f.delete(key)
  else f.add(key)
  query.value = { ...query.value, folded: f.size ? [...f] : undefined }
}

// ---------- the fields shown (remembered) ----------
const COLS_KEY = 'qa.jira.cols'
const cols = ref<JiraColumn[]>(
  (() => {
    try {
      return jiraColumnsOf(JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null'))
    } catch {
      return jiraColumnsOf(undefined)
    }
  })(),
)
watch(cols, (v) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(v))
  } catch {
    // fine
  }
})
const anyFilter = computed(() => !!(query.value.statuses?.length || query.value.assignee?.length || query.value.priorities?.length || query.value.due?.length || query.value.labels?.length))
const resetFilters = () => (query.value = { sort: query.value.sort, desc: query.value.desc, view: query.value.view, folded: query.value.folded })

const { items, total, found, facets, loading, onScroll, more } = useJiraFind(q, { page: 60, query })
/** The tasks among the loaded rows (an ancestor shown for its descendants is none; a folded one counts what it hides). */
const tasksIn = (rows: typeof items.value) => rows.reduce((n, i) => n + (i.context ? 0 : 1) + (i.folded ? (i.inside ?? 0) : 0), 0)
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

/** The loaded page(s), by project (they come sorted by it; in the tree — by its branch's root's project). */
const groups = computed(() => {
  const out: Array<[string, { name: string; items: typeof items.value }]> = []
  for (const i of items.value) {
    const key = i.section ?? i.project.key
    const last = out[out.length - 1]
    if (last && last[0] === key) last[1].items.push(i)
    else out.push([key, { name: (i.project.key === key && i.project.name) || key, items: [i] }])
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
function open(key: string): void {
  if (jira.value.siteUrl) openUrl(`${jira.value.siteUrl}/browse/${key}`)
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
const syncedText = computed(() => (jira.value.syncedAt ? new Date(jira.value.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'))
</script>

<template>
  <div ref="listEl" class="tasks tw:pt-12 tw:pr-14 tw:pb-16 tw:pl-14 tw:overflow-auto tw:flex tw:flex-col tw:gap-14" @scroll.passive="onScroll">
    <div class="topbar tw:flex tw:items-center tw:gap-10 tw:flex-wrap">
      <input v-model="q" class="search tw:w-260 tw:py-5 tw:px-9 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[13px]" placeholder="Поиск по задачам" spellcheck="false" />
      <template v-if="jira.connected">
        <FilterMenu v-model="fStatus" label="Статус" icon="layers" :options="statusOpts" />
        <FilterMenu v-model="fAssignee" label="Исполнитель" icon="users" :options="ASSIGNEE" />
        <FilterMenu v-model="fPriority" label="Приоритет" icon="flag" :options="priorityOpts" />
        <FilterMenu v-model="fDue" label="Срок" icon="calendar" :options="DUE" />
        <FilterMenu v-model="fLabels" label="Метки" icon="tag" :options="labelOpts" />
        <button v-if="anyFilter" class="ico tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:text-muted tw:inline-flex tw:py-5 tw:px-7" title="Сбросить фильтры" @click="resetFilters"><Icon name="x" :size="13" /></button>
        <span class="spacer tw:flex-1"></span>
        <button class="ico tw:inline-flex tw:items-center tw:gap-5 tw:py-5 tw:px-7 tw:[&.on]:text-accent-fg" :class="{ on: tree }" :title="tree ? 'Дерево: задачи под историями, эпиками и выше · нажмите — списком' : 'Списком · нажмите — деревом (по родителям: solution → эпик → история → задача)'" @click="toggleView"><Icon :name="tree ? 'branch' : 'list'" :size="14" /></button>
        <TaskFieldsMenu v-model="cols" />
        <span class="sortbox tw:inline-flex tw:items-center tw:gap-2">
          <select class="tw:h-28 tw:py-0 tw:px-6 tw:border tw:border-border tw:rounded-[4px] tw:bg-field tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12.5px]" v-model="query.sort" title="Сортировка (внутри проекта)">
            <option v-for="o in SORTS" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
          <button class="ico tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:text-muted tw:inline-flex tw:py-5 tw:px-7" :title="query.desc !== false ? 'По убыванию · нажмите — по возрастанию' : 'По возрастанию · нажмите — по убыванию'" @click="query.desc = query.desc === false"><Icon :name="query.desc !== false ? 'sortDesc' : 'sortAsc'" :size="14" /></button>
        </span>
      </template>
    </div>

    <div v-if="!jira.connected" class="connect tw:flex tw:flex-col tw:items-center tw:gap-10 tw:p-40 tw:text-muted tw:text-center">
      <Icon name="link" :size="22" />
      <p>Jira не подключена. Укажите Client ID и Secret своего приложения Atlassian и войдите — в настройках.</p>
      <button class="primary tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:text-muted tw:hover:enabled:bg-accent-hi tw:hover:enabled:border-accent-hi" @click="emit('settings')">Открыть настройки</button>
    </div>

    <template v-else>
      <div class="bar tw:flex tw:items-center tw:gap-10 tw:flex-wrap">
        <span class="muted small tw:text-[12px]">Все незакрытые задачи · {{ found }}<template v-if="items.length < total"> · загружено строк {{ items.length }} из {{ total }}</template></span>
        <span class="spacer tw:flex-1"></span>
        <span class="muted small tw:text-[12px]" :title="jira.error ? `Последняя попытка ${hm(jira.errorAt)}: ${jira.error}
Задачи — из последней удачной синхронизации (${syncedText}). Следующая попытка — по расписанию или кнопкой.` : ''">
          <template v-if="jira.syncing || spinning">синхронизация…</template>
          <template v-else-if="jira.error">синхр. {{ syncedText }} · <span class="err tw:text-down-fg">{{ hm(jira.errorAt) }} ошибка: {{ jira.error }}</span></template>
          <template v-else>синхр. {{ syncedText }} · каждые 10 мин</template>
        </span>
        <button class="ico tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:not-[&.on]:text-muted tw:[.seg_&]:[&.on]:bg-accent/25 tw:[.seg_&]:[&.on]:text-text tw:inline-flex tw:py-5 tw:px-7 tw:[&.on]:text-accent-fg" :class="{ on: anyOpen }" :title="anyOpen ? 'Свернуть все задачи' : 'Раскрыть все задачи — описание и поля'" @click="anyOpen ? ((allOpen = false), (openSet = new Set())) : toggleAll()"><Icon :name="anyOpen ? 'collapse' : 'expand'" :size="14" /></button>
        <button v-if="groups.length > 1" class="ico tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:text-muted tw:inline-flex tw:py-5 tw:px-7" :title="allFolded ? 'Развернуть все проекты' : 'Свернуть все проекты'" @click="foldAll"><Icon :name="allFolded ? 'chevronDown' : 'collapse'" :size="14" /></button>
        <button class="ico tw:[.seg_&]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:bg-transparent tw:[.seg_&]:py-5 tw:[.seg_&]:px-12 tw:[.seg_&]:text-[12px] tw:[.seg_&]:text-muted tw:inline-flex tw:py-5 tw:px-7" title="Синхронизировать сейчас" :disabled="jira.syncing || spinning" @click="sync"><Icon class="tw:[&.spin]:animate-[TaskList-spin_0.9s_linear_infinite]" name="refresh" :size="14" :class="{ spin: jira.syncing || spinning }" /></button>
      </div>

      <section v-for="[key, g] in groups" :key="key" class="proj tw:group/proj tw:bg-panel tw:border tw:border-border tw:rounded-[4px] tw:py-10 tw:px-14" :class="{ folded: folded.has(key) }">
        <h3 class="tw:flex tw:items-center tw:gap-6 tw:cursor-pointer tw:select-none tw:mt-2 tw:mr-0 tw:mb-8 tw:ml-0 tw:text-[11px] tw:font-data tw:font-semibold tw:tracking-[0.08em] tw:uppercase tw:text-text-2 tw:group-[.folded]/proj:mb-2" :title="folded.has(key) ? 'Развернуть' : 'Свернуть'" @click="fold(key)">
          <Icon name="chevronRight" :size="12" class="fchev tw:[transform:rotate(90deg)] tw:[transition:transform_0.15s] tw:text-muted tw:group-[.folded]/proj:transform-none" />{{ g.name }} <span class="muted tw:font-normal tw:text-[12px]">{{ key }}</span><span class="cnt tw:ml-auto tw:py-0 tw:px-7 tw:rounded-[9px] tw:bg-hover tw:text-muted tw:font-normal">{{ tasksIn(g.items) }}</span>
        </h3>
        <template v-for="i in folded.has(key) ? [] : g.items" :key="i.key">
        <TaskRow :i="i" :cols="cols" :open="isOpen(i.key)" :tree="tree" :tracked="tracked[i.key] ?? 0" :worked="worked[i.key] ?? []" :today="today" @details="toggleOpen(i.key)" @fold="foldNode(i.key)" @jira="open" @work="workTask = { key: i.key, summary: i.summary }" />
        <JiraDetails v-if="isOpen(i.key)" class="det tw:mt-0 tw:mr-0 tw:mb-6 tw:ml-18 tw:border-l-2 tw:border-l-accent tw:bg-panel-2" :issue="full[i.key] ?? i" />
        </template>
      </section>
      <p v-if="loading" class="muted small tw:text-[12px]">Загрузка…</p>
      <p v-else-if="!groups.length" class="muted">{{ anyFilter ? 'Под фильтры ничего не подходит.' : 'Задач нет.' }}</p>
    </template>
    <EventModal v-if="workTask" text="" :task="workTask" @created="(workTask = undefined), loadTracked()" @close="workTask = undefined" />
  </div>
</template>

<style scoped src="./TaskList.css"></style>
