<script setup lang="ts">
/**
 * «Расписания» in a note (```cron): a schedule made for this note, and every note's schedules — their last runs
 * (done, failed, missed while the app was closed), on / off, run now, deleted.
 */
import Icon from '@renderer/components/Icon.vue'
import CronPanel from './CronPanel.vue'

defineProps<{ path: string }>()
</script>

<template>
  <div class="tw:contain-[inline-size] tw:min-w-0 tw:flex tw:flex-col tw:gap-8 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="tw:flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:overflow-hidden">
      <Icon name="clock" :size="13" class="tw:text-accent-fg" /><b class="tw:text-text">Расписания</b>
      <span class="tw:min-w-0 tw:truncate">«Выполнить всё» документа по cron · в документе есть {{ '{' }}{{ '{' }}trigger{{ '}' }}{{ '}' }} — кто запустил</span>
    </div>
    <CronPanel :note="path" all />
  </div>
</template>
