<script setup lang="ts">
import Icon from '../../components/Icon.vue'
import AttrChips from '../../components/AttrChips.vue'
import { noteIcon } from '@shared/tracker/constants'
import { useCalendarState } from './useTaskCalendar'

/** The days' canvas: columns and hour lines, the pointer's moment, the new / drafted event, events, note pins, now. */
const { els, g, hourPx, onDown, onMove, onUp, onDbl, onContext, hover, visibleNums, isOff, todayNum, toKey, colW, xOf, widthOf, subLines, formatHM, yOf, openDraft, MINUTE, draft, GUT, HOUR, placed, nowMs, selectedId, kindColor, titleOf, entryIcon, fanZone, fan, notePins, pinPlaces, openNote, firstDay, lastDay, nowY, hours } = useCalendarState()
</script>

<template>
  <div
    :ref="els.canvas"
    class="canvas tw:relative tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:[&&]:shrink-0 tw:cursor-crosshair tw:select-none tw:touch-none tw:[&.panning]:cursor-grabbing"
    :class="{ panning: g?.kind === 'pan', creating: g?.kind === 'create' }"
    :style="{ height: `${24 * hourPx}px` }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="g = undefined"
    @pointerleave="hover = undefined"
    @dblclick="onDbl"
    @contextmenu.prevent="onContext"
  >
    <div
      v-for="n in visibleNums"
      :key="`c${n}`"
      class="col tw:absolute tw:top-0 tw:bottom-0 tw:box-border tw:pointer-events-none tw:[&.sep]:not-[&.month]:border-l tw:[&.sep]:not-[&.month]:border-l-white/5 tw:[&&]:group-[.roomy]/strip:[&.sep]:border-l-white/7 tw:[&.off]:not-[&.today]:bg-down/5 tw:[&.month]:border-l tw:[&.month]:border-l-muted/45 tw:[&.today]:bg-info/10"
      :class="{ off: isOff(n), today: n === todayNum, month: toKey(n).endsWith('-01'), sep: colW >= 8 }"
      :style="{ left: `${xOf(n)}px`, width: `${widthOf(n)}px` }"
    ></div>
    <div v-for="h in hours" :key="`h${h}`" class="hline tw:absolute tw:left-0 tw:right-0 tw:border-t tw:border-t-white/5 tw:pointer-events-none" :style="{ top: `${h * hourPx}px` }"></div>
    <div v-for="s in subLines" :key="`sl${s.label}`" class="hline sub tw:[&&]:[border-top-style:dashed] tw:[&&]:border-t-white/3 tw:[&&]:[&.half]:border-t-white/4.5 tw:absolute tw:left-0 tw:right-0 tw:border-t tw:border-t-white/5 tw:pointer-events-none" :class="{ half: s.half }" :style="{ top: `${s.y}px` }"></div>

    <!-- the pointer's moment on the day: a line + "+" to add an event there -->
    <template v-if="hover && (!g || g.kind === 'pending') && colW >= 40">
      <div class="hcur tw:absolute tw:z-2 tw:h-0 tw:border-t tw:border-t-accent/75 tw:pointer-events-none" :style="{ left: `${xOf(hover.n)}px`, width: `${widthOf(hover.n)}px`, top: `${yOf(hover.t, toKey(hover.n))}px` }">
        <span class="hcur-t tw:absolute tw:left-2 tw:-top-14 tw:py-0 tw:px-4 tw:rounded-r2 tw:bg-bg/85 tw:text-accent-fg tw:text-[10px]">{{ formatHM(hover.t) }}</span>
      </div>
      <button
        class="hplus tw:absolute tw:z-6 tw:inline-flex tw:items-center tw:justify-center tw:w-20 tw:h-20 tw:p-0 tw:border-0 tw:rounded-[50%] tw:bg-accent tw:text-on-accent tw:[box-shadow:0_2px_8px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:hover:bg-accent tw:hover:[transform:scale(1.1)] tw:hover:enabled:border-border-3"
        :style="{ left: `${xOf(hover.n) + widthOf(hover.n) - 24}px`, top: `${yOf(hover.t, toKey(hover.n)) - 10}px` }"
        :title="`Новое событие ${formatHM(hover.t)}`"
        @pointerdown.stop
        @click.stop="openDraft(toKey(hover.n), hover.t, hover.t + 30 * MINUTE)"
      ><Icon name="plus" :size="13" :stroke="2.6" /></button>
    </template>
    <!-- the new event being set up in the panel -->
    <div
      v-if="draft"
      class="draftev tw:absolute tw:z-6 tw:box-border tw:py-3 tw:px-6 tw:rounded-r2 tw:text-text-hi tw:text-[10.5px] tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:pointer-events-none tw:[background:linear-gradient(90deg,var(--accent-fg)_50%,transparent_0)_repeat-x_top_left/10px_1.5px,linear-gradient(90deg,var(--accent-fg)_50%,transparent_0)_repeat-x_bottom_left/10px_1.5px,linear-gradient(0deg,var(--accent-fg)_50%,transparent_0)_repeat-y_top_left/1.5px_10px,linear-gradient(0deg,var(--accent-fg)_50%,transparent_0)_repeat-y_top_right/1.5px_10px,rgb(var(--accent-rgb)/0.2)] tw:animate-[TaskCalendar-ants_0.7s_linear_infinite]"
      :style="{ left: `${xOf(draft.n) + GUT}px`, width: `${widthOf(draft.n) - 2 * GUT}px`, top: `${yOf(draft.start, draft.day)}px`, height: `${Math.max(18, ((draft.end - draft.start) / HOUR) * hourPx - 1)}px` }"
    >
      <span>Новое событие · {{ formatHM(draft.start) }}–{{ formatHM(draft.end) }}</span>
    </div>
    <!-- a new event being drawn -->
    <div
      v-if="g?.kind === 'create'"
      class="newev tw:absolute tw:z-6 tw:box-border tw:py-2 tw:px-5 tw:border tw:border-dashed tw:border-accent-fg tw:rounded-r2 tw:bg-accent/25 tw:text-text-hi tw:text-[10.5px] tw:pointer-events-none"
      :style="{ left: `${xOf(g.day) + GUT}px`, width: `${widthOf(g.day) - 2 * GUT}px`, top: `${yOf(Math.min(g.t0, g.t1), toKey(g.day))}px`, height: `${Math.max(4, (Math.abs(g.t1 - g.t0) / HOUR) * hourPx)}px` }"
    >
      {{ formatHM(Math.min(g.t0, g.t1)) }}–{{ formatHM(Math.max(g.t0, g.t1)) }}
    </div>

    <!-- events -->
    <div
      v-for="p in placed"
      :key="p.e.id"
      class="ev tw:absolute tw:box-border tw:pt-1 tw:pr-3 tw:pb-1 tw:pl-4 tw:border-l-3 tw:border-l-(--c) tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_30%,var(--bg))] tw:text-text tw:text-[10.5px] tw:leading-[12.5px] tw:overflow-hidden tw:cursor-grab tw:z-1 tw:[&.thin]:p-0 tw:[&.thin]:not-[&.future]:border-l-0 tw:[&.thin]:rounded-[1.5px] tw:[&.thin]:not-[&.future]:[background:var(--c)] tw:[&.thin]:not-[&.dragging]:opacity-85 tw:hover:not-[&.sel]:not-[&.dragging]:z-3 tw:hover:filter-[brightness(1.2)] tw:[&.sel]:not-[&.dragging]:[box-shadow:0_0_0_2px_var(--text-hi),0_4px_14px_rgba(0,0,0,0.5)] tw:[&.sel]:not-[&.dragging]:z-4 tw:[&.dragging]:z-5 tw:[&.dragging]:cursor-grabbing tw:[&.dragging]:[box-shadow:0_8px_22px_rgba(0,0,0,0.55)] tw:[&.dragging]:opacity-92 tw:[&.future]:[background:repeating-linear-gradient(135deg,rgba(255,255,255,0.07)_0_4px,transparent_4px_9px),color-mix(in_srgb,var(--c)_20%,var(--bg))] tw:[&.future]:[border-left-style:dashed] tw:[&.thin]:[&.future]:[background:var(--c)] tw:[&&]:[&.thin]:[&.future]:opacity-45 tw:before:content-[''] tw:before:absolute tw:before:left-0 tw:before:right-0 tw:before:h-5 tw:before:cursor-ns-resize tw:before:select-none tw:before:top-0 tw:after:content-[''] tw:after:absolute tw:after:left-0 tw:after:right-0 tw:after:h-5 tw:after:cursor-ns-resize tw:after:select-none tw:after:bottom-0"
      :class="{ future: p.e.start > nowMs, thin: p.w < 40, dragging: p.dragging, sel: selectedId === p.e.id }"
      :data-entry="p.e.id"
      :style="{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, '--c': kindColor(p.e.kind), '--lines': p.lines }"
      :title="`${formatHM(p.e.start)}–${formatHM(p.e.end)} ${p.e.task ? p.e.task.key + ' ' : ''}${titleOf(p.e)}`"
    >
      <template v-if="p.w >= 40">
        <div v-if="p.lines" class="et tw:font-semibold tw:whitespace-normal tw:[word-break:break-word] tw:overflow-hidden tw:[display:-webkit-box] tw:[-webkit-box-orient:vertical] tw:[-webkit-line-clamp:var(--lines)]"><Icon :name="entryIcon(p.e)" :size="10" :stroke="2.4" class="eic tw:[&&]:inline-block tw:mr-2 tw:[&&]:[vertical-align:-1px]" /><span v-if="p.e.task" class="key tw:text-info-fg tw:font-semibold">{{ p.e.task.key }}</span> {{ titleOf(p.e) }}<Icon v-if="p.e.series" name="repeat" :size="9" :stroke="2.4" class="eflag tw:[&&]:inline-block tw:ml-4 tw:[&&]:[vertical-align:-1px] tw:opacity-80" /><Icon v-if="p.e.remind && !p.e.remind.fired" name="bell" :size="9" :stroke="2.4" class="eflag tw:[&&]:inline-block tw:ml-4 tw:[&&]:[vertical-align:-1px] tw:opacity-80" /></div>
        <div v-if="p.time" class="em tw:text-[10px] tw:text-muted tw:whitespace-nowrap">{{ formatHM(p.e.start) }}–{{ formatHM(p.e.end) }}</div>
        <AttrChips v-if="p.e.attrs" class="tw:mt-2" :attrs="p.e.attrs" />
      </template>
    </div>

    <!-- notes -->
    <div
      v-if="fanZone"
      class="fanzone tw:absolute tw:rounded-[4px] tw:bg-warn/8 tw:cursor-default"
      :style="{ left: `${fanZone.left}px`, top: `${fanZone.top}px`, width: `${fanZone.width}px`, height: `${fanZone.height}px`, zIndex: 8 }"
      @pointerenter="fan.enter(fan.open.value!)"
      @pointerleave="fan.leave()"
    ></div>
    <button
      v-for="p in notePins"
      :key="p.note.id"
      class="npin tw:absolute tw:z-5 tw:inline-flex tw:items-center tw:justify-center tw:w-15 tw:h-15 tw:p-0 tw:border-0 tw:rounded-r2 tw:bg-warn tw:text-bg tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:[transition:transform_0.18s_cubic-bezier(0.32,0.72,0,1)] tw:hover:enabled:bg-hover tw:hover:enabled:border-border-3"
      :data-note="p.note.id"
      :style="{ left: `${p.x}px`, top: `${p.y - 7}px`, transform: fan.shift(pinPlaces.get(p.note.id), 18, -1), zIndex: 8 + (pinPlaces.get(p.note.id)?.n ?? 1) - (pinPlaces.get(p.note.id)?.i ?? 0) }"
      @pointerenter="pinPlaces.get(p.note.id) && fan.enter(pinPlaces.get(p.note.id)!.key)"
      @pointerleave="fan.leave()"
      :title="`${formatHM(p.note.at)} ${p.note.text || p.note.transcript || (p.note.audio ? 'Аудиозаметка' : '')}`"
      @pointerdown.stop
      @click.stop="openNote(p.day, { id: p.note.id, at: p.note.at, text: p.note.text, taskId: p.note.taskId })"
    >
      <Icon :name="noteIcon(p.note)":size="9" :stroke="2.4" />
    </button>

    <div v-if="todayNum >= firstDay && todayNum <= lastDay" class="now tw:absolute tw:h-2 tw:bg-down tw:z-4 tw:pointer-events-none" :style="{ left: `${xOf(todayNum)}px`, width: `${widthOf(todayNum)}px`, top: `${nowY}px` }"></div>
  </div>
</template>
