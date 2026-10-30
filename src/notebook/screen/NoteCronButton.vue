<script setup lang="ts">
/**
 * «Расписание» of a note in its tab row: the note's schedules (a new one; their last runs, on / off, run now). Lit
 * when the note has one switched on.
 */
import { computed, ref } from 'vue'
import Icon from '@renderer/components/Icon.vue'
import Popover from '@renderer/components/Popover.vue'
import { useCronJobs } from '@nb/workspace/cronStore'
import CronPanel from '@nb/blocks/cron/CronPanel.vue'

const props = defineProps<{ path: string }>()
const btn = ref<HTMLElement>()
const open = ref(false)
const jobs = useCronJobs()
const on = computed(() => jobs.value.filter((j) => j.note === props.path && j.on).length)
</script>

<template>
  <span ref="btn" class="tw:inline-flex">
    <button
      class="tb tw:relative tw:inline-flex tw:items-center tw:justify-center tw:w-28 tw:h-28 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:enabled:bg-white/7 tw:hover:enabled:text-text tw:[&.on]:bg-accent/22 tw:[&.on]:text-accent-fg tw:[&.lit]:text-accent-fg"
      :class="{ on: open, lit: on }"
      :title="on ? `Расписание: включено ${on}` : 'Расписание — выполнять документ по cron'"
      @click="open = !open"
    >
      <Icon name="clock" :size="14" />
    </button>
  </span>
  <Popover v-model:open="open" :anchor="btn" :width="520" class="tw:fixed tw:z-5000 tw:max-h-[min(560px,75vh)] tw:p-10 tw:border tw:border-border-2 tw:rounded-r3 tw:bg-pop tw:shadow-pop tw:overflow-y-auto">
    <div class="tw:flex tw:items-center tw:gap-6 tw:pb-8 tw:text-muted tw:text-[12px]"><Icon name="clock" :size="13" /><b class="tw:text-text">Расписание документа</b><span class="tw:min-w-0 tw:truncate">«Выполнить всё» по cron · все расписания — компонент @cron</span></div>
    <CronPanel :note="path" />
  </Popover>
</template>
