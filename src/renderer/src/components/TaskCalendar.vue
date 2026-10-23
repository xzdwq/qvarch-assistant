<script setup lang="ts">
import CalendarToolbar from '../tracker/calendar/CalendarToolbar.vue'
import CalendarContextMenu from '../tracker/calendar/CalendarContextMenu.vue'
import CalendarDateHeader from '../tracker/calendar/CalendarDateHeader.vue'
import CalendarCanvas from '../tracker/calendar/CalendarCanvas.vue'
import CalendarFooter from '../tracker/calendar/CalendarFooter.vue'
import CalendarSidePanel from '../tracker/calendar/CalendarSidePanel.vue'
import { useTaskCalendar } from '../tracker/calendar/useTaskCalendar'

/**
 * The work as a calendar: an endless strip of days (past and future — Outlook meetings live there), hours
 * top to bottom at a readable height. Everything the timeline does is here too: drag down on a day to add
 * an event, drag an event to another time or day, pull its edge to resize, click to edit / delete in the
 * side panel (the same editor as the main window), notes with voice / call audio.
 * Wheel — hours; Shift + wheel, a wheel over the dates or a sideways drag — days; Ctrl + wheel — zoom.
 */
/** `fill` — the calendar section: it takes the whole window height (the dashboard widget sizes it itself). */
const props = defineProps<{ workDays?: number[]; fill?: boolean }>()
const emit = defineEmits<{ openDay: [day: string] }>()

const { roomy, els, hours, hourPx, subLines, resetHours } = useTaskCalendar(props, (day) => emit('openDay', day))
</script>

<template>
  <div class="tcal tw:group/tcal tw:flex tw:flex-col tw:gap-8 tw:[&.fill]:box-border tw:[&.fill]:h-full" :class="{ fill }">
    <CalendarToolbar />

    <CalendarContextMenu />
    <div class="wrap tw:flex tw:gap-0 tw:h-[calc(100vh-200px)] tw:min-h-440 tw:group-[.fill]/tcal:flex-1 tw:group-[.fill]/tcal:h-auto tw:group-[.fill]/tcal:min-h-300">
      <div class="strip tw:group/strip tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:border tw:border-border tw:rounded-[4px] tw:overflow-hidden tw:bg-panel" :class="{ roomy }">
        <!-- dates: fixed on top -->
        <CalendarDateHeader />

        <!-- hours: scroll vertically -->
        <div :ref="els.body" class="sbody tw:flex-1 tw:min-h-0 tw:flex tw:items-start tw:overflow-y-auto tw:overflow-x-hidden tw:[&::-webkit-scrollbar]:w-6">
          <div class="hours tw:flex-none tw:w-50 tw:border-r tw:border-r-border tw:relative tw:cursor-ns-resize tw:select-none" title="Колесо мыши" @dblclick="resetHours">
            <div v-for="h in hours" :key="h" class="hr tw:box-border tw:pt-0 tw:pr-6 tw:pb-0 tw:pl-0 tw:text-right tw:text-[10.5px] tw:leading-none tw:text-muted tw:[transform:translateY(-5px)]" :style="{ height: `${hourPx}px` }">{{ h && hourPx >= 13 ? `${String(h).padStart(2, '0')}:00` : h % 3 === 0 && h ? `${String(h).padStart(2, '0')}` : '' }}</div>
            <div v-for="s in subLines" :key="`s${s.label}`" class="hsub tw:absolute tw:right-6 tw:text-[9px] tw:leading-none tw:text-muted tw:opacity-[0.55] tw:[transform:translateY(-4px)] tw:pointer-events-none tw:[&.half]:opacity-80" :class="{ half: s.half }" :style="{ top: `${s.y}px` }">{{ s.label }}</div>
          </div>
          <CalendarCanvas />
        </div>

        <!-- footer: per day -->
        <CalendarFooter />
      </div>

      <!-- side panel -->
      <!-- the whole gap between the calendar and the panel is the handle -->
      <CalendarSidePanel />
    </div>
  </div>
</template>

<style scoped src="./TaskCalendar.css"></style>
