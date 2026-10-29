<script setup lang="ts">
/** «Поля»: which fields the task list shows beside a task's key and title (each switched on / off; back to the default). */
import { ref } from 'vue'
import { DEFAULT_JIRA_COLUMNS, JIRA_COLUMN, JIRA_COLUMNS, type JiraColumn } from '@shared/jiraColumns'
import Icon from '../components/Icon.vue'
import Popover from '../components/Popover.vue'

const cols = defineModel<JiraColumn[]>({ required: true })
const btn = ref<HTMLElement>()
const open = ref(false)
const toggle = (c: JiraColumn) => (cols.value = JIRA_COLUMNS.filter((x) => (x === c ? !cols.value.includes(c) : cols.value.includes(x))))
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button class="ico tw:inline-flex tw:items-center tw:gap-5 tw:py-5 tw:px-7 tw:[&.on]:text-accent-fg" :class="{ on: open }" title="Поля списка — что показывать у задачи" @click="open = !open"><Icon name="columns" :size="14" /></button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="230" class="tw:fixed tw:z-5000 tw:flex tw:flex-col tw:gap-1 tw:p-5 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:text-[12.5px]">
    <span class="tw:px-8 tw:pt-2 tw:pb-4 tw:text-muted tw:text-[11.5px]">Ключ и название — всегда</span>
    <label v-for="c in JIRA_COLUMNS" :key="c" class="tw:flex tw:items-center tw:gap-8 tw:h-26 tw:px-8 tw:rounded-r2 tw:cursor-pointer tw:whitespace-nowrap tw:hover:bg-hover">
      <input type="checkbox" :checked="cols.includes(c)" @change="toggle(c)" /><span>{{ JIRA_COLUMN[c].title }}</span>
      <span v-if="!JIRA_COLUMN[c].width" class="tw:ml-auto tw:text-muted tw:text-[11px]">в названии</span>
    </label>
    <span class="tw:h-1 tw:my-3 tw:bg-border"></span>
    <button class="tw:flex tw:items-center tw:h-26 tw:px-8 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-left tw:text-text-2 tw:hover:bg-hover" @click="cols = [...DEFAULT_JIRA_COLUMNS]">По умолчанию</button>
  </Popover>
</template>
