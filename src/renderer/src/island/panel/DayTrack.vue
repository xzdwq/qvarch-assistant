<script setup lang="ts">
import { labelWithoutKey } from '@shared/jira'
import { formatHM } from '@shared/timeline'
import Icon from '../../components/Icon.vue'
import { entryIcon, kindColor } from '../../lib/palette'
import { useIsland } from '../islandState'
import { LANE_GAP, LANE_H, TRACK_W } from '../useIslandTrack'

/**
 * The day's track: schedule bands, the plan, blocks on lanes (drag to move / resize), the selection band, now,
 * note pins (fanning out), hidden-side counters, the time divider. Gestures: useTrackPointer.
 */
const { els, island, day, track, pointer, pick, menu } = useIsland()
const { ui } = island
const { data, now, schedule, noteTitle, noteIcon } = day
const { vp, from, to, box, pct, px, resized, segs, shownLanes, rowStyle, rowInnerStyle, laneStyle } = track
const { hidden, revealSide, notePins, fan, pinPlaces, fanZone, hoverT } = track
const { onTrackDown, onTrackMove, onTrackUp, onPinDown, onEdgeDown, onResizeDown } = pointer
const { entryId, selectedEntry, multi, marker, activeEnd, pinT, panelNote, openPanelNote } = pick
const { onTrackContext } = menu
</script>

<template>
  <div
    :ref="els.track"
    class="track tw:relative tw:cursor-crosshair tw:select-none"
    @wheel.prevent="vp.onWheel($event, els.track.value!)"
    @pointerdown="onTrackDown"
    @pointermove="onTrackMove"
    @pointerup="onTrackUp"
    @pointerleave="hoverT = undefined"
    @mousedown.middle.prevent
    @contextmenu.prevent="onTrackContext"
  >
    <div v-if="schedule.work" class="sch-work tw:bg-accent/10 tw:border-l-2 tw:border-l-accent/70 tw:border-r-2 tw:border-r-accent/70" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
    <template v-if="schedule.work">
      <div v-if="schedule.work[0] > from" class="sch-off tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:bg-black/25" :style="box(from, schedule.work[0], 0)"></div>
      <div v-if="schedule.work[1] < to" class="sch-off tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:bg-black/25" :style="box(schedule.work[1], to, 0)"></div>
    </template>
    <div v-if="schedule.lunch" class="sch-lunch tw:[background:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--lunch-mark)_16%,transparent)_0_5px,color-mix(in_srgb,var(--lunch-mark)_6%,transparent)_5px_10px)] tw:border-l tw:[border-left-style:dashed] tw:border-l-[color-mix(in_srgb,var(--lunch-mark-fg)_60%,transparent)] tw:border-r tw:[border-right-style:dashed] tw:border-r-[color-mix(in_srgb,var(--lunch-mark-fg)_60%,transparent)]" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>
    <div class="row-scroll tw:relative tw:overflow-y-auto tw:overflow-x-hidden tw:[transition:height_0.25s_cubic-bezier(0.32,0.72,0,1)] tw:[&::-webkit-scrollbar]:w-4" :style="rowStyle">
    <div :ref="els.rowMain" class="row-main tw:relative" :style="rowInnerStyle">
      <div v-for="l in shownLanes" :key="`lane${l}`" class="lane-bg tw:left-0 tw:right-0 tw:rounded-r2 tw:bg-white/2.5 tw:pointer-events-none tw:absolute tw:top-0 tw:bottom-0" :style="{ top: `${(l - 1) * (LANE_H + LANE_GAP)}px`, height: `${LANE_H}px` }"></div>
      <!-- the day plan, dashed under the blocks (settings → interface) -->
      <template class="tw:absolute tw:top-0 tw:bottom-0" v-if="ui.island.plan">
        <div
          v-for="p in data.plan ?? []"
          :key="`pl${p.id}`"
          class="planseg tw:border tw:border-dashed tw:border-(--c) tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--c)_12%,transparent)] tw:pointer-events-none tw:absolute tw:top-0 tw:bottom-0"
          :style="{ ...box(p.start, p.end), top: '0px', height: `${LANE_H}px`, bottom: 'auto', '--c': kindColor(p.kind) }"
          :title="`План: ${p.task ? p.task.key + ' ' : ''}${p.label} · ${formatHM(p.start)}–${formatHM(p.end)}`"
        ></div>
      </template>
      <div
        v-for="(s, i) in segs"
        :key="`s${i}`"
        class="seg tw:group/seg tw:absolute tw:top-0 tw:bottom-0 tw:rounded-r2 tw:[background:var(--c)] tw:text-text-hi tw:text-[11px] tw:flex tw:items-center tw:gap-4 tw:overflow-hidden tw:[transition:filter_0.15s,box-shadow_0.15s] tw:hover:filter-[brightness(1.15)] tw:cursor-grab tw:[&.moving]:cursor-grabbing tw:[&.moving]:not-[&.multi]:not-[&.sel]:[box-shadow:0_6px_16px_rgba(0,0,0,0.5)] tw:[&.moving]:not-[&.sel]:z-3 tw:[&.multi]:not-[&.sel]:[box-shadow:0_0_0_2px_var(--warn),0_0_10px_color-mix(in_srgb,var(--warn)_35%,transparent)] tw:[&.sel]:[box-shadow:0_0_0_2px_var(--text-hi)] tw:[&.sel]:z-2"
        :data-entry="s.entry.id"
        :class="{ sel: s.entry.id === entryId || multi.has(s.entry.id), multi: multi.has(s.entry.id), moving: resized?.id === s.entry.id }"
        :style="{ ...box(s.start, s.end), '--c': kindColor(s.entry.kind), ...laneStyle(s) }"
      >
        <span v-if="s.start === s.entry.start && px(s.start, s.end, TRACK_W) >= 26" class="rh l tw:absolute tw:top-0 tw:bottom-0 tw:w-6 tw:cursor-ew-resize tw:z-2 tw:left-0 tw:group-hover/seg:bg-white/40 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" @pointerdown="onResizeDown($event, s.entry, 'start')"></span>
        
        <Icon v-if="px(s.start, s.end, TRACK_W) >= 18" :name="entryIcon(s.entry)" :size="12" :stroke="2.2" class="sic tw:ml-6" />
        <span v-if="px(s.start, s.end, TRACK_W) >= 54" class="stxt tw:whitespace-nowrap tw:overflow-hidden tw:text-ellipsis tw:pr-6 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"><b v-if="s.entry.task" class="tkey tw:font-extrabold tw:mr-2">{{ s.entry.task.key }}</b> {{ labelWithoutKey(s.entry.label, s.entry.task?.key) }}</span>
        <span v-if="s.end === s.entry.end && px(s.start, s.end, TRACK_W) >= 26" class="rh r tw:absolute tw:top-0 tw:bottom-0 tw:w-6 tw:cursor-ew-resize tw:z-2 tw:right-0 tw:group-hover/seg:bg-white/40 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" @pointerdown="onResizeDown($event, s.entry, 'end')"></span>
      </div>
    </div>
    </div>
    <Transition name="fade">
      <div v-if="marker && !selectedEntry" class="band tw:absolute tw:-top-3 tw:-bottom-3 tw:border-2 tw:border-accent-fg tw:rounded-[4px] tw:bg-accent/14 tw:pointer-events-none tw:z-3 tw:[transition:border-color_0.2s,background_0.2s]" :style="box(marker.start, activeEnd, 0)">
        <span class="cap l tw:absolute tw:-top-21 tw:py-1 tw:px-6 tw:rounded-r2 tw:bg-text-hi tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:pointer-events-auto tw:cursor-ew-resize tw:z-6 tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:right-full tw:-mr-10 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" title="Тяните — граница выделения" @pointerdown="onEdgeDown($event, 'start')">{{ formatHM(marker.start) }}</span>
        <span class="cap r tw:absolute tw:-top-21 tw:py-1 tw:px-6 tw:rounded-r2 tw:bg-text-hi tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:pointer-events-auto tw:cursor-ew-resize tw:z-6 tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:left-full tw:-ml-10 tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" title="Тяните — граница выделения" @pointerdown="onEdgeDown($event, 'end')">{{ marker.end ? formatHM(activeEnd) : 'сейчас' }}</span>
      </div>
    </Transition>
    <div class="nowline tw:absolute tw:-top-4 tw:-bottom-2 tw:w-2 tw:-ml-1 tw:bg-down tw:pointer-events-none tw:z-4" :style="{ left: `${pct(now)}%` }"></div>
    <div
      v-if="fanZone"
      class="fanzone tw:absolute tw:rounded-[4px] tw:bg-warn/8 tw:cursor-default"
      :style="{ left: `${fanZone.pct}%`, marginLeft: '-11px', top: '-4px', width: `${fanZone.width}px`, height: '22px', zIndex: 8 }"
      @pointerdown.stop
      @click.stop
      @dblclick.stop
      @pointerenter="fan.enter(fan.open.value!)"
      @pointerleave="fan.leave()"
    ></div>
    <span
      v-for="n in notePins"
      :key="n.id"
      class="notepin tw:[&.on]:[outline:2px_solid_var(--text-hi)] tw:absolute tw:top-0 tw:z-7 tw:[transition:transform_0.18s_cubic-bezier(0.32,0.72,0,1)] tw:inline-flex tw:items-center tw:justify-center tw:w-14 tw:h-14 tw:-ml-7 tw:rounded-r2 tw:bg-warn tw:text-bg tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2"
      :class="{ on: panelNote?.id === n.id }"
      :data-note="n.id"
      :style="{ left: `${pct(n.at)}%`, transform: fan.shift(pinPlaces.get(n.id), 16), zIndex: 8 + (pinPlaces.get(n.id)?.n ?? 1) - (pinPlaces.get(n.id)?.i ?? 0) }"
      @pointerenter="pinPlaces.get(n.id) && fan.enter(pinPlaces.get(n.id)!.key)"
      @pointerleave="fan.leave()"
      :title="`${noteTitle(n)}\nПотяните к блоку — связать`"
      @pointerdown.stop
      @click.stop="openPanelNote(n)"
    >
      <Icon :name="noteIcon(n)" :size="10" :stroke="2.2" />
    </span>
    <button v-if="hidden.left" class="hid l tw:absolute tw:top-6 tw:z-7 tw:py-2 tw:px-7 tw:rounded-r2 tw:border-0 tw:bg-accent/90 tw:text-text-hi tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:[box-shadow:0_2px_8px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:hover:bg-accent tw:left-2 tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:hover:enabled:not-[.seg2_&]:border-border-3" :title="`Скрыто слева: ${hidden.left}`" @pointerdown.stop @click="revealSide('left')">&lt;{{ hidden.left }}</button>
    <button v-if="hidden.right" class="hid r tw:absolute tw:top-6 tw:z-7 tw:py-2 tw:px-7 tw:rounded-r2 tw:border-0 tw:bg-accent/90 tw:text-text-hi tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:[box-shadow:0_2px_8px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:hover:bg-accent tw:right-2 tw:[.seg2_&]:border-0 tw:[.seg2_&]:rounded-none tw:[.seg2_&]:py-3 tw:[.seg2_&]:px-8 tw:[.seg2_&]:text-[11px] tw:[.seg2_&]:not-hover:bg-transparent tw:hover:enabled:not-[.seg2_&]:border-border-3" :title="`Скрыто справа: ${hidden.right}`" @pointerdown.stop @click="revealSide('right')">&gt;{{ hidden.right }}</button>
    <div v-if="pinT !== undefined && pinT >= from && pinT <= to" class="pinline tw:absolute tw:-top-18 tw:-bottom-2 tw:w-2 tw:-ml-1 tw:bg-text-hi tw:rounded-[1px] tw:pointer-events-none tw:z-5 tw:[box-shadow:0_0_6px_rgba(0,0,0,0.6)]" :style="{ left: `${pct(pinT)}%` }">
      <span class="tw:pointer-events-auto tw:cursor-ew-resize tw:absolute tw:-top-4 tw:left-[50%] tw:[transform:translateX(-50%)] tw:py-1 tw:px-6 tw:rounded-r2 tw:bg-text-hi tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:[.abar_&]:block tw:[.abar_&]:h-full tw:[.abar_&]:rounded-r2" title="Тяните влево или вправо" @pointerdown="onPinDown">{{ formatHM(pinT) }}</span>
    </div>
  </div>
</template>

<style scoped src="./DayTrack.css"></style>
