<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { tasksWord, type TaskRef } from '@shared/jira'
import { useJiraFind } from '../lib/jiraFind'
import { usePopover } from '../lib/usePopover'
import { OWN_PREFIX } from '@shared/board'
import Icon from './Icon.vue'

/**
 * Pick the task(s) a block of time belongs to: own tasks (Q-n) + my open Jira tasks + the ones picked by hand.
 * Taking an existing task again (another day) keeps it one task — its time adds up; a new own task can be
 * made right here from the search text.
 * Several tasks (checkboxes) → one parallel block per task for the same time; `single` → just one.
 * The list fits into the space the host leaves (the island clips — and clicks outside it go through).
 */
const props = defineProps<{ single?: boolean; compact?: boolean }>()
const tasks = defineModel<TaskRef[]>({ default: () => [] })

const q = ref('')
const search = ref<HTMLInputElement>()
/**
 * The list: over everything, under or over the button (from the button itself — the wrapper may be stretched by its
 * row, the mini island); kept by it while the page scrolls, closed when it is out of sight. `room` — the list's height.
 */
const btn = ref<HTMLElement>()
const { open, panelRef, style, up, room } = usePopover(btn, { width: 440, maxHeight: 'none' })

type Item = { key: string; summary: string; due?: string; own: boolean }
/** Jira tasks only (own tasks are gone: a note becomes a "Задача" block, not a task of its own). */
// asked page by page from the main process (the search goes there too)
const { items: found, onScroll: onFindScroll } = useJiraFind(q, { page: 40, active: open, mode: 'pick' })
const list = computed<Item[]>(() => found.value.map((i) => ({ key: i.key, summary: i.summary, due: i.due, own: false })))
const isOwn = (key?: string) => !!key?.startsWith(OWN_PREFIX)
const chosen = (key: string) => tasks.value.some((t) => t.key === key)
const label = computed(() => (!tasks.value.length ? 'Jira' : tasks.value.length === 1 ? tasks.value[0].key : `${tasks.value[0].key} +${tasks.value.length - 1}`))

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) {
    q.value = ''
    await nextTick()
    search.value?.focus({ preventScroll: true })
  }
}
function pick(i: TaskRef): void {
  const t = { key: i.key, summary: i.summary }
  if (props.single) {
    tasks.value = chosen(i.key) ? [] : [t]
    open.value = false
    return
  }
  tasks.value = chosen(i.key) ? tasks.value.filter((x) => x.key !== i.key) : [...tasks.value, t]
}
</script>

<template>
  <div class="tp tw:relative tw:flex-none" :class="{ compact: props.compact }">
    <button
      ref="btn"
      class="chip tw:inline-flex tw:items-center tw:gap-6 tw:max-w-180 tw:h-36 tw:box-border tw:py-0 tw:px-12 tw:rounded-[4px] tw:border tw:border-border tw:bg-field tw:text-muted tw:text-[13px] tw:cursor-pointer tw:[transition:border-color_0.15s,color_0.15s] tw:hover:not-[&.on]:border-accent tw:hover:not-[&.on]:text-text tw:[&.on]:border-info/70 tw:[&.on]:bg-info/14 tw:[&.on]:text-info-fg tw:hover:enabled:not-[&.on]:bg-hover"
      :class="{ on: tasks.length }"
      :title="tasks.length ? tasks.map((t) => `${t.key} — ${t.summary}`).join('\n') : 'Задача'"
      @click="toggle"
    >
      <Icon :name="isOwn(tasks[0]?.key) ? 'checkSquare' : 'jira'" :size="13" />
      <span class="lbl tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:font-semibold">{{ label }}</span>
      <span v-if="tasks.length" class="x tw:inline-flex tw:opacity-70 tw:hover:opacity-100" title="Отвязать" @click.stop="tasks = []"><Icon name="x" :size="11" /></span>
    </button>
    <Teleport to="body">
    <div v-if="open" :ref="panelRef" class="dd tw:absolute tw:z-60 tw:top-[calc(100%+4px)] tw:right-0 tw:w-440 tw:p-6 tw:rounded-[4px] tw:bg-panel-2 tw:border tw:border-border tw:[box-shadow:var(--shadow-menu)] tw:[&.up]:top-auto tw:[&.up]:bottom-[calc(100%+4px)]" :class="{ up }" :style="style">
      <input class="tw:w-full tw:box-border tw:mb-4 tw:py-6 tw:px-8 tw:rounded-r2 tw:border tw:border-border tw:bg-black/25 tw:text-text tw:[font-style:inherit] tw:[font-variant:inherit] tw:[font-weight:inherit] tw:font-stretch-[inherit] tw:[line-height:inherit] tw:font-[inherit] tw:[&&]:text-[12px] tw:outline-none"
        ref="search"
        v-model="q"
        :placeholder="single ? 'Найти задачу Jira' : 'Найти задачу Jira · можно отметить несколько'"
        spellcheck="false"
        @keydown.enter.prevent="list[0] && pick(list[0])"
      />
      <div class="items tw:overflow-auto" :style="{ maxHeight: `${room}px` }" @scroll.passive="onFindScroll">
        <button v-for="i in list" :key="i.key" class="it tw:flex tw:items-center tw:gap-8 tw:w-full tw:py-5 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-text tw:text-left tw:text-[12px] tw:cursor-pointer tw:hover:not-[&.cur]:bg-info/16 tw:[&.cur]:bg-info/16 tw:hover:enabled:border-border-3" :class="{ cur: chosen(i.key) }" @click="pick(i)">
          <span v-if="!single" class="cb tw:flex-none tw:inline-flex tw:items-center tw:justify-center tw:w-14 tw:h-14 tw:rounded-r2 tw:border tw:border-white/35 tw:text-text-hi tw:[&.on]:bg-info tw:[&.on]:border-info" :class="{ on: chosen(i.key) }"><Icon v-if="chosen(i.key)" name="check" :size="11" :stroke="3" /></span>
          <Icon :name="i.own ? 'checkSquare' : 'jira'" :size="11" class="src tw:[&&]:flex-none tw:text-info-fg" :class="{ own: i.own }" />
          <b class="tw:flex-none tw:text-info-fg" :class="{ own: i.own }">{{ i.key }}</b>
          <span class="sum tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{{ i.summary }}</span>
          <span v-if="i.due" class="due tw:flex-none tw:text-muted tw:text-[11px]">до {{ i.due.slice(8, 10) }}.{{ i.due.slice(5, 7) }}</span>
        </button>
        <p v-if="!list.length" class="empty tw:my-6 tw:mx-8 tw:text-muted tw:text-[12px]">{{ q.trim() ? 'Не найдено' : 'Нет задач Jira — подключите Jira в настройках' }}</p>
      </div>
      <div v-if="!single && tasks.length > 1" class="foot tw:mt-4 tw:mr-6 tw:mb-0 tw:ml-6 tw:text-[11px] tw:text-info-fg">{{ tasksWord(tasks.length) }} — на это время будет столько же параллельных блоков</div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped src="./TaskPicker.css"></style>
