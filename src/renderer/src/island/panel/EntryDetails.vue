<script setup lang="ts">
import { formatDuration, formatHM } from '@shared/timeline'
import type { Entry } from '@shared/types'
import Icon from '../../components/Icon.vue'
import LabelInput from '../../components/LabelInput.vue'
import TaskPicker from '../../components/TaskPicker.vue'
import TimeRange from '../../components/TimeRange.vue'
import { kindColor, kindIcon, kindLabel } from '../../lib/palette'
import { useIsland } from '../islandState'

/**
 * The highlighted block: kind, title, time, task, description; edit (times, text, task, kind) or delete it,
 * open it in the app. The block comes as a prop so a leaving card keeps showing it while it fades out.
 */
defineProps<{ entry: Entry }>()
const state = useIsland()
const { recent, shownKinds } = state.day
const { entryId } = state.pick
const { edit, startEdit, saveEdit, removeEntry } = state.edit
const { openMain } = state
</script>

<template>
  <div class="details tw:flex tw:flex-col tw:gap-10">
    <div class="d-title tw:flex tw:items-center tw:gap-8 tw:text-[15px] tw:font-semibold">
      <span class="kic tw:inline-flex tw:items-center tw:justify-center tw:w-22 tw:h-22 tw:rounded-r2 tw:text-text-hi tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" :style="{ background: kindColor(entry.kind) }"><Icon :name="kindIcon(entry.kind)" :size="13" :stroke="2.2" /></span>
      {{ kindLabel(entry.kind) }} · {{ entry.label }}
    </div>
    <div class="d-sub tw:text-text-2 tw:text-[13px]">
      {{ formatHM(entry.start) }}–{{ formatHM(entry.end) }} · {{ formatDuration(entry.end - entry.start) }}
    </div>
    <div v-if="entry.task && !edit" class="d-task tw:flex tw:items-center tw:gap-6 tw:-mt-2 tw:mr-0 tw:mb-4 tw:ml-0 tw:text-[12px] tw:text-info-fg"><Icon name="checkSquare" :size="12" /><b class="tw:text-info-fg">{{ entry.task.key }}</b> {{ entry.task.summary }}</div>
    <div v-if="entry.description && !edit" class="d-desc tw:-mt-2 tw:mr-0 tw:mb-6 tw:ml-0 tw:text-[12px] tw:leading-[1.45] tw:text-text-2 tw:whitespace-pre-wrap tw:max-h-72 tw:overflow-auto">{{ entry.description }}</div>
    <template v-if="!edit">
      <div class="mini-actions tw:flex tw:items-center tw:gap-6">
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:py-4 tw:px-9 tw:rounded-r2 tw:text-[12px] tw:bg-white/4 tw:border tw:border-white/10 tw:hover:bg-white/9" @click="startEdit(entry)"><Icon name="pencil" :size="13" />Изменить</button>
        <button class="danger tw:inline-flex tw:items-center tw:gap-5 tw:py-4 tw:px-9 tw:rounded-r2 tw:text-[12px] tw:bg-white/4 tw:border tw:border-white/10 tw:hover:bg-white/9 tw:text-down-fg" @click="removeEntry"><Icon name="trash" :size="13" />Удалить</button>
        <span class="spacer tw:flex-1 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"></span>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:py-4 tw:px-9 tw:rounded-r2 tw:text-[12px] tw:bg-white/4 tw:border tw:border-white/10 tw:hover:bg-white/9" title="Открыть в приложении" @click="openMain(entry.id)"><Icon name="external" :size="13" /></button>
        <button class="tw:inline-flex tw:items-center tw:gap-5 tw:py-4 tw:px-9 tw:rounded-r2 tw:text-[12px] tw:bg-white/4 tw:border tw:border-white/10 tw:hover:bg-white/9" title="Закрыть (Esc)" @click="entryId = undefined"><Icon name="x" :size="13" /></button>
      </div>
    </template>
    <div v-else class="editbox tw:flex tw:flex-col tw:gap-8" @keydown.enter.exact.prevent="saveEdit">
      <div class="times tw:flex tw:items-center tw:gap-6 tw:min-h-28 tw:text-[13px]">
        <TimeRange class="tw:[.abar_&]:block tw:[.abar_&]:not-[&.boxed]:h-full tw:[.abar_&]:not-[&.boxed]:rounded-r2" boxed :start="edit.start" :end="edit.end" @change="(r) => ((edit!.start = r.start), (edit!.end = r.end))" />
      </div>
      <div class="editrow tw:flex tw:items-start tw:gap-8">
        <LabelInput v-model="edit.label" drop-up no-recent multiline :recent="recent" placeholder="Shift+Enter — новая строка" @submit="saveEdit" />
        <TaskPicker v-model="edit.tasks" single compact />
      </div>
      <div class="actions tw:flex tw:gap-8 tw:items-stretch">
        <button class="apply tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-46 tw:rounded-[4px] tw:bg-up tw:border tw:border-up tw:text-text-hi tw:[&&]:hover:enabled:bg-up tw:hover:enabled:not-[.seg2_&]:border-border-3" title="Сохранить (Enter)" @click="saveEdit"><Icon name="check" :size="18" :stroke="2.6" /></button>
        <div class="kseg tw:flex-1 tw:min-w-0 tw:flex tw:border tw:border-white/12 tw:rounded-[4px] tw:overflow-hidden">
          <button class="tw:[.seg2_&]:[&.on]:not-hover:bg-accent tw:flex-[1_1_0] tw:min-w-0 tw:flex tw:flex-col tw:items-center tw:gap-3 tw:pt-6 tw:pr-4 tw:pb-5 tw:pl-4 tw:border-0 tw:rounded-none tw:[&&]:border-l tw:[&&]:border-l-white/8 tw:bg-white/2 tw:text-[11px] tw:text-text-2 tw:[&&]:first:border-l-0 tw:hover:bg-white/7 tw:[&.on]:text-text-hi"
            v-for="k in shownKinds"
            :key="k.id"
            :class="{ on: edit.kind === k.id }"
            :style="edit.kind === k.id ? { background: k.color } : {}"
            :title="k.label"
            @click="edit.kind = k.id"
          >
            <Icon :name="k.icon" :size="14" />
            <span class="tw:max-w-full tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2">{{ k.label }}</span>
          </button>
        </div>
        <button class="cancel tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:bg-transparent tw:flex-none tw:flex tw:items-center tw:justify-center tw:w-38 tw:rounded-[4px] tw:bg-white/4 tw:border tw:border-white/10 tw:hover:enabled:not-[.seg2_&]:bg-hover tw:hover:enabled:not-[.seg2_&]:border-border-3" title="Отмена (Esc)" @click="edit = undefined"><Icon name="x" :size="16" /></button>
      </div>
    </div>
  </div>
</template>
