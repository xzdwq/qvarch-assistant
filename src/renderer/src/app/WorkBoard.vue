<script setup lang="ts">
import { ref } from 'vue'
import type { Quick } from '@shared/quickadd'
import type { PublicSettings } from '@shared/types'
import QuickAdd, { type QuickDraft } from '../components/QuickAdd.vue'
import { todayKey } from '../lib/today'
import { mondayOf } from '../lib/useRange'
import BoardHead from '../tracker/board/BoardHead.vue'
import BoardTop from '../tracker/board/BoardTop.vue'
import BoardFeed from '../tracker/board/BoardFeed.vue'
import BoardStream from '../tracker/board/BoardStream.vue'
import { placeQuick } from '@shared/tracker/boardTime'
import { provideWorkBoard } from '../tracker/board/useWorkBoard'

/**
 * «Моя работа» · Работа: the week at a glance (each day's done and planned time), one line to add anything,
 * the chosen day as a feed (done → now → plan, free gaps in between), and the tasks of the day / the week.
 */
const props = defineProps<{ settings: PublicSettings; focus?: { day: string; entryId?: string; n: number } }>()
const emit = defineEmits<{ openDay: [day: string, entryId?: string] }>()
const quick = ref<InstanceType<typeof QuickAdd>>()
const { day, now, err, fail, reload, flashFor, addTaskToDay } = provideWorkBoard(props, quick)

const placeQ = (q: Quick) => placeQuick(q, now.value, todayKey.value)
/** The quick line's record: saved, its task joins the day, the day shown and the new block lit. */
async function onQuick(q: QuickDraft): Promise<void> {
  err.value = ''
  try {
    const e = await window.qa.saveEntry(q.day, { start: q.start, end: q.end, kind: q.kind, label: q.label, task: q.task ? { key: q.task.key, summary: q.task.summary } : undefined, source: 'manual' }, { overlap: true })
    if (q.task) await addTaskToDay(q.day, q.task)
    day.value = q.day
    await reload()
    flashFor(e.id, 1600)
  } catch (x) {
    fail(x)
  }
}
</script>

<template>
  <div class="wb tw:flex tw:flex-col tw:gap-10 tw:h-full tw:min-h-0 tw:pt-10 tw:pr-14 tw:pb-12 tw:pl-14 tw:overflow-hidden tw:@container">
    <!-- the week -->
    <BoardHead />
    <BoardTop />

    <QuickAdd ref="quick" class="qadd" :day="day" :week-start="mondayOf(day)" :place="placeQ" @add="onQuick" />
    <p v-if="err" class="err tw:m-0 tw:text-down-fg tw:text-[12px]">{{ err }}</p>

    <div class="wgrid tw:flex-1 tw:min-h-0 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] tw:gap-12 tw:items-stretch tw:[&&]:@max-[900px]:grid-cols-[minmax(0,1fr)] tw:@max-[900px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
      <!-- the day -->
      <BoardFeed @open-day="(d) => emit('openDay', d)" />

      <!-- the side: the open block, or the tasks -->
      <BoardStream />
    </div>
  </div>
</template>

<style scoped src="./WorkBoard.css"></style>
