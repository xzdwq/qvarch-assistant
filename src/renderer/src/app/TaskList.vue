<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { JiraIssue, MyTaskStatus } from '@shared/jira'
import { formatDuration } from '@shared/timeline'
import Icon from '../components/Icon.vue'
import { formatSec, useJira } from '../lib/jira'
import JiraDetails from '../components/JiraDetails.vue'
import { useJiraFind } from '../lib/jiraFind'

/**
 * Jira: every open task of the projects, by project and due date — page by page as the list is scrolled; the
 * search goes to the main process. My own status (review / done) is set here. The estimate is compared with the
 * time tracked in the app on blocks linked to the task.
 */
const emit = defineEmits<{ settings: []; openDay: [day: string] }>()
const jira = useJira()
const q = ref('')
/** The task opened up (fields and description) — asked for in full when opened. */
const opened = ref<string>()
const openedIssue = ref<JiraIssue>()
watch(opened, async (k) => {
  openedIssue.value = undefined
  if (k) openedIssue.value = (await window.qa.jiraIssue(k)) ?? undefined
})
const { items, total, loading, onScroll } = useJiraFind(q, { page: 60 })
const tracked = ref<Record<string, number>>({})

async function loadTracked(): Promise<void> {
  tracked.value = await window.qa.jiraTracked()
}
onMounted(loadTracked)
watch(() => jira.value.syncedAt, loadTracked)

const isDone = (i: JiraIssue) => i.category === 'done' || jira.value.myStatus[i.key] === 'done'
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
  <div class="tasks" @scroll.passive="onScroll">
    <div class="topbar">
      <input v-model="q" class="search" placeholder="Поиск по задачам" spellcheck="false" />

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
        <span class="muted small" :title="jira.error">
          <template v-if="jira.syncing">синхронизация…</template>
          <template v-else-if="jira.error"><span class="err">ошибка: {{ jira.error }}</span></template>
          <template v-else>синхр. {{ syncedText }} · каждые 10 мин</template>
        </span>
        <button class="ico" title="Синхронизировать сейчас" :disabled="jira.syncing" @click="sync"><Icon name="refresh" :size="14" /></button>
      </div>

      <section v-for="[key, g] in groups" :key="key" class="proj">
        <h3>{{ g.name }} <span class="muted">{{ key }}</span></h3>
        <template v-for="i in g.items" :key="i.key">
        <div class="row" :class="{ done: isDone(i), open: opened === i.key }">
          <button class="chev" :title="opened === i.key ? 'Свернуть' : 'Описание и поля'" @click="opened = opened === i.key ? undefined : i.key"><Icon name="chevronRight" :size="13" /></button>
          <button class="star" :class="{ on: jira.starred.includes(i.key) }" :title="i.mine ? 'Назначена на вас' : jira.starred.includes(i.key) ? 'Убрать из выбранных' : 'Выбрать себе'" @click="star(i)">
            <Icon :name="i.mine ? 'users' : 'star'" :size="13" />
          </button>
          <a class="key" href="#" :title="`Открыть ${i.key} в Jira`" @click.prevent="open(i)">{{ i.key }}</a>
          <span class="sum" :title="i.summary" @click="opened = opened === i.key ? undefined : i.key">
            <span class="sumt">{{ i.summary }}</span>
            <i v-for="c in (i.components ?? []).slice(0, 2)" :key="`c${c}`" class="tg comp">{{ c }}</i>
            <i v-for="l in (i.labels ?? []).slice(0, 3)" :key="`l${l}`" class="tg">{{ l }}</i>
          </span>
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
        <JiraDetails v-if="opened === i.key" class="det" :issue="openedIssue ?? i" />
        </template>
      </section>
      <p v-if="loading" class="muted small">Загрузка…</p>
      <p v-else-if="!groups.length" class="muted">Задач нет.</p>
    </template>
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
.seg,
.mine-seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
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
  margin: 2px 0 8px;
  font-size: 11px;
  font-family: var(--font-data);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-2);
}
h3 .muted {
  font-weight: 400;
  font-size: 12px;
}
.row {
  display: grid;
  grid-template-columns: 18px 26px 84px minmax(0, 1fr) 96px 120px 128px 48px 150px;
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
.star {
  display: inline-flex;
  justify-content: center;
  padding: 3px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.star.on {
  color: var(--warn);
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
.mine-seg button {
  padding: 3px 8px;
  font-size: 11px;
}
.mine-seg button.on {
  background: rgb(var(--accent-rgb) / 0.28);
  color: var(--accent-fg);
}
.mine-seg button.on:last-child {
  background: rgba(0, 230, 118, 0.25);
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
