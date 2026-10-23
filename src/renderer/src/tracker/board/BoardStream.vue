<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../../components/Icon.vue'
import EventStream from '../../components/EventStream.vue'
import { recentLabels } from '../../lib/recent'
import { useWorkBoard } from './useWorkBoard'

/** The board's side: the period's events as a stream (the open block edited there), its order and follow switches. */
const { settings, days, reload, now, weekTitle, feedOrder, streamLinked, streamFollow, openId, hoverId } = useWorkBoard()
const recent = computed(() => recentLabels(...days.value.map((d) => d.entries)))
</script>

<template>
  <aside class="side tw:flex tw:flex-col tw:min-h-0 tw:overflow-hidden tw:min-w-0 tw:border tw:border-border tw:rounded-r3 tw:bg-panel tw:pb-6">
    <div class="cap fh tw:flex tw:items-center tw:justify-between tw:gap-8 tw:h-34 tw:pt-0 tw:pr-10 tw:pb-0 tw:pl-12 tw:border-b tw:border-b-border tw:whitespace-nowrap"><span>Лента · {{ weekTitle }}</span><span class="sbtns tw:inline-flex tw:gap-2">
        <button class="tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg"
          :class="{ on: streamLinked === 'on' }"
          :title="streamLinked === 'on' ? 'Порядок связан с записями слева (сейчас — ' + (feedOrder === 'desc' ? 'сначала новые' : 'сначала старые') + '). Нажмите — свой порядок: сначала старые' : 'Свой порядок: сначала старые. Нажмите — как в записях слева'"
          @click="streamLinked = streamLinked === 'on' ? 'off' : 'on'"
        ><Icon name="link" :size="13" /></button>
        <button class="tw:inline-flex tw:items-center tw:h-24 tw:py-0 tw:px-6 tw:border tw:border-border-2 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-accent-fg tw:[.seg_&]:not-[.quick_&]:h-22 tw:[.seg_&]:not-[.quick_&]:py-0 tw:[.seg_&]:not-[.quick_&]:px-10 tw:[.seg_&]:not-[&.on]:border-0 tw:[.seg_&]:rounded-none tw:[.seg_&]:not-[&.on]:bg-transparent tw:[.seg_&]:not-[&.on]:not-[.quick_&]:text-muted tw:[.seg_&]:not-[.quick_&]:font-data tw:[.seg_&]:not-[.quick_&]:text-[10.5px] tw:[.seg_&]:uppercase tw:[.seg_&]:[&.on]:bg-accent-soft tw:[.seg_&]:[&.on]:text-accent-fg tw:[.quick_&]:h-22 tw:[.quick_&]:py-0 tw:[.quick_&]:px-6 tw:[.quick_&]:font-data tw:[.quick_&]:text-[10.5px] tw:[.quick_&]:not-[&.on]:text-text-2 tw:[&&]:[.quick_&]:hover:border-accent tw:[&&]:[.quick_&]:hover:text-accent-fg"
          :class="{ on: streamFollow === 'on' }"
          :title="streamFollow === 'on' ? 'Подсветка включена: запись под указателем слева выделяется в ленте. Нажмите — выключить' : 'Подсветка выключена. Нажмите — выделять в ленте запись под указателем слева'"
          @click="streamFollow = streamFollow === 'on' ? 'off' : 'on'"
        ><Icon name="eye" :size="13" /></button>
      </span></div>
    <EventStream class="stream tw:flex-1 tw:min-h-0" :days="days" :schedule="settings.schedule" :recent="recent" :now="now" :focus-id="streamFollow === 'on' ? hoverId : undefined" :open-id="openId" :order="streamLinked === 'on' ? feedOrder : 'asc'" @open="(id) => (openId = id)" @changed="reload" />
  </aside>
</template>
