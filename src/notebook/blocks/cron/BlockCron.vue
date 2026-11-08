<script setup lang="ts">
/**
 * «Расписания» in a note (```cron): a schedule made for this note, and every note's schedules — their last runs
 * (done, failed, missed while the app was closed), on / off, run now, deleted.
 */
import FoldHead from '../../ui/FoldHead.vue'
import { useBlockFold } from '../../ui/blockFold'
import CronPanel from './CronPanel.vue'

defineProps<{ path: string }>()
/** Folded to its head (the host's fold, kept per block): the chevron at the head's start. */
const fold = useBlockFold()
</script>

<template>
  <div class="tw:contain-[inline-size] tw:min-w-0 tw:flex tw:flex-col tw:gap-8 tw:py-8 tw:px-10 tw:border tw:border-border tw:rounded-[8px] tw:bg-panel">
    <div class="tw:flex tw:items-center tw:gap-6 tw:text-muted tw:text-[12px] tw:whitespace-nowrap tw:overflow-hidden">
      <FoldHead icon="clock" kind="Расписания" :fold="fold" />
      <span class="tw:min-w-0 tw:truncate">«Выполнить всё» документа по cron · в документе есть {{ '{' }}{{ '{' }}trigger{{ '}' }}{{ '}' }} — кто запустил</span>
    </div>
    <template v-if="!fold || fold.open">
    <CronPanel :note="path" all />
    </template>
  </div>
</template>
