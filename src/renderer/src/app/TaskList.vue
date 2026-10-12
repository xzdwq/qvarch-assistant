<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { JiraIssue, MyTaskStatus } from '@shared/jira'
import { formatDuration } from '@shared/timeline'
import Icon from '../components/Icon.vue'
import { formatSec, useJira } from '../lib/jira'

/**
 * Jira tasks: grouped by project, by due date. "Мои" = assigned to me in Jira + picked by hand (★);
 * "Все открытые" lists the projects' open tasks to pick from. My own status (review / done) is set here.
 * The estimate is compared with the time tracked in the app on blocks linked to the task.
 */
const emit = defineEmits<{ settings: []; openDay: [day: string] }>()
const jira = useJira()
const mode = ref<'mine' | 'all'>('mine')
const q = ref('')
const showDone = ref(false)
const tracked = ref<Record<string, number>>({})

async function loadTracked(): Promise<void> {
  tracked.value = await window.qa.jiraTracked()
}
onMounted(loadTracked)
watch(() => jira.value.syncedAt, loadTracked)

const isDone = (i: JiraIssue) => i.category === 'done' || jira.value.myStatus[i.key] === 'done'
const CAT_ORDER = { indeterminate: 0, new: 1, done: 2 } as const

const groups = computed(() => {
  const s = q.value.trim().toLowerCase()
  const list = jira.value.issues.filter(
    (i) =>
      (mode.value === 'all' || i.mine || jira.value.starred.includes(i.key)) &&
      (showDone.value || !isDone(i)) &&
      (!s || i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)),
  )
  const byProject = new Map<string, { name: string; items: JiraIssue[] }>()
  for (const i of list) {
    const g = byProject.get(i.project.key) ?? { name: i.project.name || i.project.key, items: [] }
    g.items.push(i)
    byProject.set(i.project.key, g)
  }
  for (const g of byProject.values())
    g.items.sort(
      (a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || CAT_ORDER[a.category] - CAT_ORDER[b.category] || b.updated - a.updated,
    )
  return [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

const today = new Date().toISOString().slice(0, 10)
const fmtDue = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
function open(i: JiraIssue): void {
  if (jira.value.siteUrl) window.qa.openExternal(`${jira.value.siteUrl}/browse/${i.key}`)
}
const sync = () => void window.qa.jiraSync()
const star = (i: JiraIssue) => window.qa.jiraStar(i.key, !jira.value.starred.includes(i.key))
const setMine = (i: JiraIssue, s: MyTaskStatus | null) => window.qa.jiraSetMyStatus(i.key, jira.value.myStatus[i.key] === s ? null : s)
/** Tracked vs estimate, 0..1+ */
const ratio = (i: JiraIssue) => (i.estimateSec ? (tracked.value[i.key] ?? 0) / 1000 / i.estimateSec : 0)
const syncedText = computed(() => (jira.value.syncedAt ? new Date(jira.value.syncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—'))
</script>

<template>
  <div class="tasks">
    <div class="topbar">
      <input v-model="q" class="search" placeholder="Поиск по задачам" spellcheck="false" />
      <label class="check"><input v-model="showDone" type="checkbox" /> готовые</label>
    </div>

    <div v-if="!jira.connected" class="connect">
      <Icon name="link" :size="22" />
      <p>Jira не подключена. Укажите Client ID и Secret своего приложения Atlassian и войдите — в настройках.</p>
      <button class="primary" @click="emit('settings')">Открыть настройки</button>
    </div>

    <template v-else>
      <div class="bar">
        <span class="seg">
          <button :class="{ on: mode === 'mine' }" @click="mode = 'mine'">Мои и выбранные</button>
          <button :class="{ on: mode === 'all' }" @click="mode = 'all'">Все открытые</button>
        </span>
        <span class="spacer"></span>
        <span class="muted small" :title="jira.error">
          <template v-if="jira.syncing">синхронизация…</template>
          <template v-else-if="jira.error"><span class="err">ошибка: {{ jira.error }}</span></template>
          <template v-else>синхр. {{ syncedText }} · каждые 10 мин</template>
        </span>
        <button class="ico" title="Синхронизировать сейчас" :disabled="jira.syncing" @click="sync"><Icon name="refresh" :size="14" /></button>
      </div>

      <section v-for="[key, g] in groups" :key="key" class="proj">
        <h3>{{ g.name }} <span class="muted">{{ key }} · {{ g.items.length }}</span></h3>
        <div v-for="i in g.items" :key="i.key" class="row" :class="{ done: isDone(i) }">
          <button class="star" :class="{ on: jira.starred.includes(i.key) }" :title="i.mine ? 'Назначена на вас' : jira.starred.includes(i.key) ? 'Убрать из выбранных' : 'Выбрать себе'" @click="star(i)">
            <Icon :name="i.mine ? 'users' : 'star'" :size="13" />
          </button>
          <a class="key" href="#" :title="`Открыть ${i.key} в Jira`" @click.prevent="open(i)">{{ i.key }}</a>
          <span class="sum" :title="i.summary">{{ i.summary }}</span>
          <span class="type muted">{{ i.type }}</span>
          <span class="st" :class="i.category">{{ i.status }}</span>
          <span class="mine-seg">
            <button :class="{ on: jira.myStatus[i.key] === 'review' }" @click="setMine(i, 'review')">Ревью</button>
            <button :class="{ on: jira.myStatus[i.key] === 'done' }" @click="setMine(i, 'done')">Готово</button>
          </span>
          <span class="due" :class="{ late: i.due && i.due < today && !isDone(i) }">{{ i.due ? fmtDue(i.due) : '' }}</span>
          <span class="est" :title="`Оценка ${formatSec(i.estimateSec)} · размечено в приложении ${formatDuration(tracked[i.key] ?? 0)} · списано в Jira ${formatSec(i.spentSec)}`">
            <span class="nums">{{ formatDuration(tracked[i.key] ?? 0) }} / {{ formatSec(i.estimateSec) }}</span>
            <span v-if="i.estimateSec" class="ebar"><span :class="{ over: ratio(i) > 1 }" :style="{ width: `${Math.min(100, ratio(i) * 100)}%` }"></span></span>
          </span>
        </div>
      </section>
      <p v-if="!groups.length" class="muted">Задач нет{{ mode === 'mine' ? ' — отметьте нужные звёздочкой во «Все открытые»' : '' }}.</p>
    </template>
  </div>
</template>

<style scoped>
.tasks {
  padding: 0;
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
.seg,
.mine-seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.seg button,
.mine-seg button {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--muted);
}
.seg button.on {
  background: rgba(99, 102, 241, 0.25);
  color: var(--text);
}
.search {
  width: 260px;
  padding: 5px 9px;
  border-radius: 8px;
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
  color: #f87171;
}
.ico {
  display: inline-flex;
  padding: 5px 7px;
}
.proj {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 14px;
}
h3 {
  margin: 2px 0 8px;
  font-size: 14px;
}
h3 .muted {
  font-weight: 400;
  font-size: 12px;
}
.row {
  display: grid;
  grid-template-columns: 26px 84px minmax(0, 1fr) 96px 120px 128px 48px 150px;
  align-items: center;
  gap: 10px;
  padding: 5px 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 13px;
}
.row.done {
  opacity: 0.5;
}
.star {
  display: inline-flex;
  justify-content: center;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.star.on {
  color: #fbbf24;
}
.key {
  color: #93c5fd;
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
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}
.st.indeterminate {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
}
.st.done {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}
.mine-seg button {
  padding: 3px 8px;
  font-size: 11px;
}
.mine-seg button.on {
  background: rgba(168, 85, 247, 0.28);
  color: #e9d5ff;
}
.mine-seg button.on:last-child {
  background: rgba(34, 197, 94, 0.25);
  color: #bbf7d0;
}
.due {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--muted);
}
.due.late {
  color: #f87171;
  font-weight: 700;
}
.est {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
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
  background: #22c55e;
}
.ebar span.over {
  background: #ef4444;
}
</style>
