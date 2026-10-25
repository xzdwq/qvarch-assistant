<script setup lang="ts">
import { openUrl } from '../lib/links'
import { computed } from 'vue'
import type { JiraIssue } from '@shared/jira'
import { formatSec, useJira } from '../lib/jira'
import { todayKey } from '../lib/today'
import Icon from './Icon.vue'
import Markdown from './Markdown.vue'

/** A Jira task opened up: its fields (status, due, components, labels, versions, parent…) and the description. */
const props = defineProps<{ issue: JiraIssue; /** Its address when this person's Jira is not connected (a shared note's snapshot). */ url?: string }>()
const jira = useJira()
const href = computed(() => (jira.value.siteUrl ? `${jira.value.siteUrl}/browse/${props.issue.key}` : props.url))
const open = () => href.value && openUrl(href.value)
const fmt = (d?: string | number) => (d ? new Date(typeof d === 'string' ? `${d}T12:00:00` : d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const late = computed(() => !!props.issue.due && props.issue.due < todayKey.value && props.issue.category !== 'done')
</script>

<template>
  <div class="jd tw:flex tw:flex-col tw:gap-10 tw:pt-10 tw:pr-12 tw:pb-12 tw:pl-12 tw:text-[12.5px]">
    <div class="jd-grid tw:grid tw:grid-cols-[max-content_1fr] tw:gap-y-5 tw:gap-x-14 tw:items-baseline">
      <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Статус</span>
      <span><i class="st tw:inline-block tw:w-7 tw:h-7 tw:mr-6 tw:rounded-[50%] tw:bg-muted tw:[&.done]:bg-up" :class="issue.category"></i>{{ issue.status }}</span>
      <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Тип</span>
      <span>{{ issue.type }}<template v-if="issue.priority"> · {{ issue.priority }}</template></span>
      <template v-if="issue.due">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Срок</span>
        <span class="num tw:font-data tw:[&.late]:text-down-fg" :class="{ late }">{{ fmt(issue.due) }}</span>
      </template>
      <template v-if="issue.estimateSec || issue.spentSec">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Оценка / списано</span>
        <span class="num tw:font-data">{{ formatSec(issue.estimateSec) }} / {{ formatSec(issue.spentSec) }}</span>
      </template>
      <template v-if="issue.parent">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Родитель</span>
        <span><b class="num tw:font-data">{{ issue.parent.key }}</b> {{ issue.parent.summary }}</span>
      </template>
      <template v-if="issue.components?.length">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Компоненты</span>
        <span class="tags tw:flex tw:flex-wrap tw:gap-4"><i v-for="c in issue.components" :key="c" class="tg comp tw:py-1 tw:px-7 tw:rounded-r2 tw:not-italic tw:font-data tw:text-[11px] tw:bg-info/16 tw:text-info-fg">{{ c }}</i></span>
      </template>
      <template v-if="issue.labels?.length">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Метки</span>
        <span class="tags tw:flex tw:flex-wrap tw:gap-4"><i v-for="l in issue.labels" :key="l" class="tg tw:py-1 tw:px-7 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2 tw:not-italic tw:font-data tw:text-[11px]">{{ l }}</i></span>
      </template>
      <template v-if="issue.versions?.length">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Версии</span>
        <span class="tags tw:flex tw:flex-wrap tw:gap-4"><i v-for="v in issue.versions" :key="v" class="tg ver tw:py-1 tw:px-7 tw:rounded-r2 tw:not-italic tw:font-data tw:text-[11px] tw:bg-up/12 tw:text-up-fg">{{ v }}</i></span>
      </template>
      <template v-if="issue.assignee || issue.reporter">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Исполнитель</span>
        <span>{{ issue.assignee ?? '—' }}<template v-if="issue.reporter"> · автор {{ issue.reporter }}</template></span>
      </template>
      <template v-if="issue.created">
        <span class="k tw:text-muted tw:font-data tw:text-[10.5px] tw:tracking-[0.06em] tw:uppercase">Создана</span>
        <span class="num tw:font-data">{{ fmt(issue.created) }}</span>
      </template>
    </div>
    <div v-if="issue.description" class="jd-desc tw:max-h-320 tw:overflow-auto tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-r2 tw:bg-field"><Markdown :text="issue.description" compact /></div>
    <p v-else class="jd-none tw:m-0 tw:text-muted">Описания нет<template v-if="!('labels' in issue)"> (появится после синхронизации)</template></p>
    <button v-if="href" class="jd-open tw:self-start tw:inline-flex tw:items-center tw:gap-6 tw:py-4 tw:px-10 tw:text-[12px]" data-link @click="open"><Icon name="external" :size="12" />Открыть в Jira</button>
  </div>
</template>

<style scoped src="./JiraDetails.css"></style>
