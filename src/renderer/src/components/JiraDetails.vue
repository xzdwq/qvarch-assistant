<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed } from 'vue'
import type { JiraIssue } from '@shared/jira'
import { formatSec, useJira } from '../lib/jira'
import { todayKey } from '../lib/today'
import Icon from './Icon.vue'
import Markdown from './Markdown.vue'

/** A Jira task opened up: its fields (status, due, components, labels, versions, parent…) and the description. */
const props = defineProps<{ issue: JiraIssue }>()
const jira = useJira()
const open = () => jira.value.siteUrl && openUrl(`${jira.value.siteUrl}/browse/${props.issue.key}`)
const fmt = (d?: string | number) => (d ? new Date(typeof d === 'string' ? `${d}T12:00:00` : d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const late = computed(() => !!props.issue.due && props.issue.due < todayKey.value && props.issue.category !== 'done')
</script>

<template>
  <div class="jd">
    <div class="jd-grid">
      <span class="k">Статус</span>
      <span><i class="st" :class="issue.category"></i>{{ issue.status }}</span>
      <span class="k">Тип</span>
      <span>{{ issue.type }}<template v-if="issue.priority"> · {{ issue.priority }}</template></span>
      <template v-if="issue.due">
        <span class="k">Срок</span>
        <span class="num" :class="{ late }">{{ fmt(issue.due) }}</span>
      </template>
      <template v-if="issue.estimateSec || issue.spentSec">
        <span class="k">Оценка / списано</span>
        <span class="num">{{ formatSec(issue.estimateSec) }} / {{ formatSec(issue.spentSec) }}</span>
      </template>
      <template v-if="issue.parent">
        <span class="k">Родитель</span>
        <span><b class="num">{{ issue.parent.key }}</b> {{ issue.parent.summary }}</span>
      </template>
      <template v-if="issue.components?.length">
        <span class="k">Компоненты</span>
        <span class="tags"><i v-for="c in issue.components" :key="c" class="tg comp">{{ c }}</i></span>
      </template>
      <template v-if="issue.labels?.length">
        <span class="k">Метки</span>
        <span class="tags"><i v-for="l in issue.labels" :key="l" class="tg">{{ l }}</i></span>
      </template>
      <template v-if="issue.versions?.length">
        <span class="k">Версии</span>
        <span class="tags"><i v-for="v in issue.versions" :key="v" class="tg ver">{{ v }}</i></span>
      </template>
      <template v-if="issue.assignee || issue.reporter">
        <span class="k">Исполнитель</span>
        <span>{{ issue.assignee ?? '—' }}<template v-if="issue.reporter"> · автор {{ issue.reporter }}</template></span>
      </template>
      <template v-if="issue.created">
        <span class="k">Создана</span>
        <span class="num">{{ fmt(issue.created) }}</span>
      </template>
    </div>
    <div v-if="issue.description" class="jd-desc"><Markdown :text="issue.description" compact /></div>
    <p v-else class="jd-none">Описания нет<template v-if="!('labels' in issue)"> (появится после синхронизации)</template></p>
    <button v-if="jira.siteUrl" class="jd-open" data-link @click="open"><Icon name="external" :size="12" />Открыть в Jira</button>
  </div>
</template>

<style scoped>
.jd {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px 12px;
  font-size: 12.5px;
}
.jd-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 5px 14px;
  align-items: baseline;
}
.k {
  color: var(--muted);
  font-family: var(--font-data);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.num {
  font-family: var(--font-data);
}
.late {
  color: var(--down-fg);
}
.st {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--muted);
}
.st.indeterminate {
  background: var(--info);
}
.st.done {
  background: var(--up);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tg {
  padding: 1px 7px;
  border-radius: var(--r2);
  background: var(--panel-3);
  color: var(--text-2);
  font-style: normal;
  font-family: var(--font-data);
  font-size: 11px;
}
.tg.comp {
  background: rgba(68, 138, 255, 0.16);
  color: var(--info-fg);
}
.tg.ver {
  background: rgba(0, 230, 118, 0.12);
  color: var(--up-fg);
}
.jd-desc {
  max-height: 320px;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--field-bg);
}
.jd-none {
  margin: 0;
  color: var(--muted);
}
.jd-open {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
}
</style>
