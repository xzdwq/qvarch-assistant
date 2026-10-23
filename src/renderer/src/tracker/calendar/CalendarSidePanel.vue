<script setup lang="ts">
import CalendarNeighbourGroup from './CalendarNeighbourGroup.vue'
import CalendarOpenCard from './CalendarOpenCard.vue'
import { useCalendarState } from './useTaskCalendar'

/** The side panel: its resize gap, the list around the open item (by day), the open card. */
const { panel, sideDrag, onSideResize, sideW, beforeGroups, afterGroups, openDay, onPanelClosed } = useCalendarState()
</script>

<template>
  <div v-if="panel" class="sgap tw:relative tw:flex-none tw:w-10 tw:cursor-col-resize tw:after:content-[''] tw:after:absolute tw:after:top-6 tw:after:bottom-6 tw:after:left-4 tw:after:w-2 tw:after:rounded-[2px] tw:after:bg-transparent tw:after:[transition:background_0.12s] tw:hover:after:not-[&.on]:bg-accent/85 tw:[&.on]:after:bg-accent/85" :class="{ on: sideDrag }" title="Потяните — ширина панели" @pointerdown.prevent.stop="onSideResize"></div>
  <aside v-if="panel" class="side tw:relative tw:flex-none tw:max-w-[60%] tw:flex tw:flex-col tw:gap-6 tw:pt-8 tw:pr-8 tw:pb-8 tw:pl-10 tw:border tw:border-border tw:rounded-[4px] tw:bg-panel tw:overflow-y-auto" :style="{ width: `${sideW}px` }" @pointerdown.stop>
    <div class="sh tw:flex tw:items-center tw:gap-4 tw:pl-4">
      <span class="muted small tw:text-[11px]">{{ panel.type === 'note' ? 'Заметка' : 'Событие' }} · по времени</span>
      <span class="grow tw:flex-1"></span>
      <button class="ib tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Открыть день в таймлайне" @click="openDay(panel.day)"><Icon name="timeline" :size="14" /></button>
      <button class="ib tw:inline-flex tw:p-4 tw:border-0 tw:rounded-r2 tw:bg-transparent tw:text-muted tw:hover:bg-hover tw:hover:text-text tw:hover:enabled:border-border-3" title="Закрыть (Esc)" @click="onPanelClosed"><Icon name="x" :size="15" /></button>
    </div>
    <div class="slist tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:flex tw:flex-col tw:gap-6 tw:pr-4">
      <CalendarNeighbourGroup v-for="g in beforeGroups" :key="g.day" :g="g" />

      <!-- the open one: highlighted, its date on the left like the others -->
      <CalendarOpenCard />

      <CalendarNeighbourGroup v-for="g in afterGroups" :key="g.day" :g="g" />
    </div>
  </aside>
</template>
