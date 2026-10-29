<script setup lang="ts">
/**
 * A task's row of the Jira list: the details' arrow, «mine», the key, the title (in the tree — shifted by its depth,
 * with the fold of its children; an ancestor shown for its descendants — dimmed), then the fields picked in «Поля»
 * in the registry's order (the grid is built of the same list), «В работу».
 */
import { computed } from 'vue'
import { priorityRank, type JiraListItem } from '@shared/jira'
import { jiraGridOf, type JiraColumn } from '@shared/jiraColumns'
import { formatDuration } from '@shared/timeline'
import Icon from '../components/Icon.vue'
import TaskWorked, { type Worked } from '../components/TaskWorked.vue'
import { formatSec } from '../lib/jira'

const props = defineProps<{
  i: JiraListItem
  cols: readonly JiraColumn[]
  open: boolean
  /** Shown as a tree (its depth and fold count). */
  tree: boolean
  tracked: number
  worked: Worked[]
  today: string
}>()
const emit = defineEmits<{ details: []; fold: []; jira: [key: string]; work: [] }>()
const shown = computed(() => new Set(props.cols))
const isDone = computed(() => props.i.category === 'done')
const prioClass = computed(() => ['', 'p1', 'p2', 'p3', 'p4', 'p5', ''][priorityRank(props.i)])
const fmtDay = (t?: number) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '')
const fmtDue = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
/** Tracked vs estimate, 0..1+ */
const ratio = computed(() => (props.i.estimateSec ? props.tracked / 1000 / props.i.estimateSec : 0))
/** A person's cell: the name, cut; the whole in the hint. */
const PEOPLE = { assignee: 'Исполнитель', reporter: 'Автор', creator: 'Создатель' } as const
</script>

<template>
  <div class="row tw:group/row tw:grid tw:items-center tw:gap-10 tw:py-5 tw:px-4 tw:border-t tw:border-t-white/4 tw:text-[13px] tw:[&.done]:opacity-50 tw:[&.ctx]:opacity-55 tw:[&.open]:bg-panel-2" :class="{ done: isDone, open, ctx: i.context }" :style="{ gridTemplateColumns: jiraGridOf(cols) }">
    <button class="chev tw:inline-flex tw:p-2 tw:border-0 tw:bg-transparent tw:text-muted tw:[transition:transform_0.12s] tw:group-[.open]/row:rotate-90 tw:group-[.open]/row:text-accent-fg tw:hover:enabled:bg-hover" :title="open ? 'Свернуть' : 'Описание и поля'" @click="emit('details')"><Icon name="chevronRight" :size="13" /></button>
    <span class="mine tw:inline-flex tw:justify-center tw:text-accent-fg" :title="i.mine ? 'Назначена на вас' : i.assignee ? `Исполнитель: ${i.assignee}` : 'Без исполнителя'"><Icon v-if="i.mine" name="users" :size="13" /></span>
    <a class="key tw:text-info-fg tw:font-semibold tw:no-underline tw:hover:underline" href="#" :title="`Открыть ${i.key} в Jira`" @click.prevent="emit('jira', i.key)">{{ i.key }}</a>
    <span class="sum tw:flex tw:items-center tw:gap-5 tw:min-w-0 tw:cursor-default tw:overflow-hidden tw:whitespace-nowrap" :title="i.context ? `${i.summary}\n(показана как родитель найденных задач)` : i.summary" :style="tree ? { paddingLeft: `${(i.depth ?? 0) * 18}px` } : undefined" @click="emit('details')">
      <!-- the tree: its children folded / unfolded (none — a place kept, the titles stay in line) -->
      <button v-if="tree && i.children" class="tw:inline-flex tw:flex-none tw:items-center tw:gap-2 tw:p-1 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:text-[10.5px] tw:font-data tw:hover:bg-hover tw:hover:text-text" :title="i.folded ? `Показать вложенные — задач внутри: ${i.inside ?? 0}` : 'Скрыть вложенные'" @click.stop="emit('fold')"><Icon :name="i.folded ? 'chevronRight' : 'chevronDown'" :size="12" /><template v-if="i.folded">{{ i.inside ?? 0 }}</template></button>
      <span v-else-if="tree" class="tw:inline-block tw:flex-none tw:w-14"></span>
      <span class="sumt tw:min-w-0 tw:overflow-hidden tw:text-ellipsis">{{ i.summary }}</span>
      <template v-if="shown.has('components')"><i v-for="c in (i.components ?? []).slice(0, 2)" :key="`c${c}`" class="tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:not-italic tw:font-data tw:text-[10.5px] tw:bg-info/16 tw:text-info-fg">{{ c }}</i></template>
      <template v-if="shown.has('labels')"><i v-for="l in (i.labels ?? []).slice(0, 3)" :key="`l${l}`" class="tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-panel-3 tw:text-text-2 tw:not-italic tw:font-data tw:text-[10.5px]">{{ l }}</i></template>
      <template v-if="shown.has('versions')"><i v-for="v in (i.versions ?? []).slice(0, 2)" :key="`v${v}`" class="tw:flex-none tw:py-0 tw:px-6 tw:rounded-r2 tw:bg-up/14 tw:text-up-fg tw:not-italic tw:font-data tw:text-[10.5px]" :title="`Версия: ${v}`">{{ v }}</i></template>
    </span>
    <span v-if="shown.has('type')" class="tw:text-muted tw:text-[11px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :title="i.level !== undefined ? `${i.type} · уровень ${i.level}` : i.type">{{ i.type }}</span>
    <span v-if="shown.has('status')" class="st tw:[justify-self:start] tw:max-w-full tw:py-1 tw:px-8 tw:rounded-r2 tw:text-[11px] tw:font-semibold tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:bg-muted/18 tw:text-text-2 tw:[&.done]:bg-up/18 tw:[&.done]:text-up-fg" :class="i.category">{{ i.status }}</span>
    <span v-if="shown.has('priority')" class="tw:overflow-hidden tw:text-muted tw:text-[11.5px] tw:text-ellipsis tw:whitespace-nowrap tw:[&.p1]:text-down-fg tw:[&.p1]:font-bold tw:[&.p2]:text-warn-fg tw:[&.p2]:font-semibold tw:[&.p3]:text-text-2" :class="prioClass" :title="i.priority ? `Приоритет: ${i.priority}` : 'Без приоритета'">{{ i.priority ?? '' }}</span>
    <template v-for="(word, who) in PEOPLE" :key="who">
      <span v-if="shown.has(who)" class="tw:text-text-2 tw:text-[12px] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :title="i[who] ? `${word}: ${i[who]}` : `${word}: —`">{{ i[who] ?? '' }}</span>
    </template>
    <span v-if="shown.has('parent')" class="tw:font-data tw:text-[11.5px] tw:text-muted tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :title="i.parent ? `Родитель: ${i.parent.key}${i.parent.summary ? ` ${i.parent.summary}` : ''}` : 'Без родителя'">{{ i.parent?.key ?? '' }}</span>
    <TaskWorked v-if="shown.has('worked')" :blocks="worked" />
    <span v-if="shown.has('due')" class="tw:tabular-nums tw:font-data tw:text-[12px] tw:text-muted tw:[&.late]:text-down-fg tw:[&.late]:font-bold" :class="{ late: i.due && i.due < today && !isDone }" :title="i.due ? `Срок выполнения ${i.due.split('-').reverse().join('.')}` : 'Без срока'">{{ i.due ? fmtDue(i.due) : '' }}</span>
    <span v-if="shown.has('created')" class="tw:text-muted tw:font-data tw:text-[11.5px] tw:tabular-nums" :title="i.created ? `Создана ${new Date(i.created).toLocaleString('ru-RU')}` : ''">{{ fmtDay(i.created) }}</span>
    <span v-if="shown.has('updated')" class="tw:text-muted tw:font-data tw:text-[11.5px] tw:tabular-nums" :title="i.updated ? `Обновлена ${new Date(i.updated).toLocaleString('ru-RU')}` : ''">{{ fmtDay(i.updated) }}</span>
    <span v-if="shown.has('estimate')" class="tw:flex tw:flex-col tw:gap-3 tw:text-[11px] tw:text-muted tw:tabular-nums tw:font-data" :title="`Оценка ${formatSec(i.estimateSec)} · размечено в приложении ${formatDuration(tracked)} · списано в Jira ${formatSec(i.spentSec)}`">
      <span>{{ formatDuration(tracked) }} / {{ formatSec(i.estimateSec) }}</span>
      <span v-if="i.estimateSec" class="tw:h-4 tw:rounded-[2px] tw:bg-white/8 tw:overflow-hidden"><span class="tw:block tw:h-full tw:bg-up tw:[&.over]:bg-down" :class="{ over: ratio > 1 }" :style="{ width: `${Math.min(100, ratio * 100)}%` }"></span></span>
    </span>
    <button class="work tw:inline-flex tw:justify-center tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-accent/18 tw:hover:text-accent-fg" title="В работу — новое событие по задаче (выберите день и время)" @click="emit('work')"><Icon name="play" :size="13" /></button>
  </div>
</template>

<style scoped src="./TaskRow.css"></style>
