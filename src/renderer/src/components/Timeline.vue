<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { labelWithoutKey } from '@shared/jira'
import { formatDuration, formatHM, sortByStart } from '@shared/timeline'
import { afterEvent } from '@shared/tracker/entryCopy'
import type { DayData, Entry, Ms, Note, Selection, UiPrefs } from '@shared/types'
import EntryCopyMenu from '../tracker/entry/EntryCopyMenu.vue'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import Icon from './Icon.vue'
import ActivityWave from './ActivityWave.vue'
import KindMenu from './KindMenu.vue'
import { ticks, visible } from '../lib/viewport'
import { timelineAxis } from '@shared/tracker/timelineAxis'
import { noteIcon } from '@shared/tracker/constants'
import { hiddenSides } from '@shared/tracker/timelineRanges'
import { useTimelineScale } from '../tracker/timeline/useTimelineScale'
import { useTimelineFollow } from '../tracker/timeline/useTimelineFollow'
import { COPY_ID, useTimelineDrag } from '../tracker/timeline/useTimelineDrag'
import { LANE_GAP } from '../tracker/timeline/useTimelineLanes'
import { PLAN_ROW, useTimelinePlanLane } from '../tracker/timeline/useTimelinePlanLane'
import { useTimelineMenu } from '../tracker/timeline/useTimelineMenu'
import { useTimelineNotePins } from '../tracker/timeline/useTimelineNotePins'

/**
 * One day as a horizontal timeline: the axis, the schedule with note pins, the plan lane, the «Работа» lanes
 * (blocks drag, resize, multi-select), the activity wave and calls; a selection band and the click divider.
 * The pieces live in tracker/timeline: scale, following the time, pointer, plan lane, menu, note pins.
 */
const props = defineProps<{
  data: DayData
  /** Live "now" for today; undefined for past days. */
  now?: Ms
  cursor: Ms
  schedule: { work?: [Ms, Ms]; lunch?: [Ms, Ms] }
  bounds: [Ms, Ms]
  initial: [Ms, Ms]
  selection: Selection | null
  selectedId?: string
  /** The note open in the editor (its pin is outlined). */
  activeNoteId?: string
  /** Planning: the plan lane is shown and accepts drops. */
  planMode?: boolean
  selectedPlanId?: string
  /** a palette item is being dragged (the plan lane lights up) */
  planDragging?: boolean
  /** Following the time (the main window): see UiPrefs.timeline. */
  follow?: UiPrefs['timeline']
  /** The window (position, scale) is remembered under this key — switching sections keeps it. */
  viewKey?: string
}>()

const emit = defineEmits<{
  /** a plan block was done / deleted from its menu */
  planChanged: []
  /** the follow-the-time switch */
  follow: [on: boolean]
  select: [id: string]
  /** commit=false while dragging (preview), true on release */
  selection: [sel: Selection | null, commit: boolean]
  resize: [change: { id: string; start: Ms; end: Ms }]
  /** right-click → kind picked for the marker (cut it as that kind) */
  cutAs: [kind: string]
  /** right-click on an entry → change its kind */
  changeKind: [change: { id: string; kind: string }]
  deleteEntry: [id: string]
  /** a block dragged to another time (overlaps go parallel) */
  move: [change: { id: string; start: Ms; end: Ms; lane: number }]
  /** a copy of a block wanted there (Ctrl + drag, «Копия сразу после»; no lane — the first free one) */
  copy: [change: { id: string; start: Ms; end: Ms; lane?: number }]
  /** a copy of a block made on the date and times picked (its menu) */
  copied: [e: Entry, day: string]
  /** Ctrl-selected blocks merged into one */
  merge: [ids: string[]]
  /** a note pin clicked (open it / close it again) */
  note: [note: Note]
  /** the moment clicked on the timeline (a new note takes it) */
  pin: [t: Ms | undefined]
  planSelect: [id: string | undefined]
  /** a plan block moved / resized */
  planChange: [change: { id: string; start: Ms; end: Ms }]
}>()

const scale = useTimelineScale(props)
const { vp, from, to, canvas, width, box, pct, selEnd } = scale
const { markManual, toggleFollow } = useTimelineFollow(props, scale, (on) => emit('follow', on))
const { drag, hoverT, multi, pinT, preview, wide, lanes, shownEntries, onLaneDown, onPinDown, onSelHandle, onResizeDown, onMiddleDown, onAxisDown, onMove, onUp, onKey } = useTimelineDrag(props, scale, emit, markManual)
const { laneH, shownLanes, mainH, mainInnerH, laneScroll, hiddenBelow, hiddenAbove, laneStyle } = lanes
const { plan, showPlan, planDrag, planShown, planRowOf, planH, onPlanDown, planTimeAt } = useTimelinePlanLane(props, scale.rawTimeAt, emit)
const { menu, planDoneIds, openPlanMenu, planMenu, onContext, onMenuDelete, onMenuMerge, onMenuPick } = useTimelineMenu(props, scale, multi, emit)
const { notePins, fan, pinPlaces, fanZone, noteTitle } = useTimelineNotePins(props, scale)
defineExpose({ reset: vp.reset, planTimeAt, toggleFollow })

/** The wheel zooms (Ctrl over «Работа» with more lanes than fit — scrolls them). */
function userWheel(e: WheelEvent): void {
  if (lanes.scrollLanes(e)) return
  markManual()
  vp.onWheel(e, canvas.value!)
}

/** Ticks + official schedule marks; "Сейчас" and schedule labels win over ticks they would overlap. */
const axis = computed(() => timelineAxis({ ticks: ticks(from.value, to.value, Math.max(6, Math.floor(width.value / 70))), from: from.value, to: to.value, widthPx: width.value, now: props.now, schedule: props.schedule }))

/** Blocks scrolled/zoomed out of view, per side — "<N" / ">N"; a click brings the outermost one back. */
const hidden = computed(() => hiddenSides(props.data.entries, from.value, to.value))
function revealSide(side: 'left' | 'right'): void {
  const pad = (to.value - from.value) * 0.03
  markManual()
  if (side === 'left') vp.panBy(hidden.value.first - pad - from.value)
  else vp.panBy(hidden.value.last + pad - to.value)
}
const main = computed(() => visible(sortByStart(shownEntries.value), from.value, to.value))

// ---------- a block's copy from its menu: right after it, or on the date and times picked ----------
const copyMenu = ref<InstanceType<typeof EntryCopyMenu>>()
const copyOf = ref<Entry>()
function copyAfterBlock(): void {
  const e = props.data.entries.find((x) => x.id === menu.value?.entryId)
  menu.value = undefined
  if (e) emit('copy', { id: e.id, ...afterEvent(e) })
}
async function copyBlockTo(): Promise<void> {
  const id = menu.value?.entryId
  menu.value = undefined
  copyOf.value = props.data.entries.find((x) => x.id === id)
  const el = canvas.value?.querySelector<HTMLElement>(`[data-entry="${id}"]`)
  await nextTick()
  if (el && copyOf.value) copyMenu.value?.show(el)
}
const calls = computed(() => visible(props.data.calls, from.value, to.value))
const legend = computed(() => ({ kinds: [...new Set(main.value.map((e) => e.kind))] }))
</script>

<template>
  <div class="root">
  <div class="tl tw:flex tw:bg-panel tw:border tw:border-border tw:rounded-r3 tw:select-none tw:outline-none tw:overflow-hidden tw:focus-visible:border-accent-soft" tabindex="0" @keydown="onKey">
    <div class="labels tw:flex-none tw:w-104 tw:border-r tw:border-r-border tw:text-[11px] tw:text-muted">
      <div class="l-axis tw:flex tw:items-center tw:py-0 tw:px-12 tw:h-30"></div>
      <div class="l-sched tw:flex tw:items-center tw:py-0 tw:px-12 tw:h-18">График</div>
      <div v-if="showPlan" class="l-plan tw:flex tw:items-center tw:py-0 tw:px-12" :style="{ height: `${planH}px` }">План</div>
      <div class="l-main tw:flex tw:items-center tw:py-0 tw:px-12 tw:h-46 tw:[transition:height_0.25s_cubic-bezier(0.32,0.72,0,1)] tw:text-text tw:font-semibold" :style="{ height: `${mainH}px` }">Работа</div>
      <div class="l-pulse tw:flex tw:items-center tw:py-0 tw:px-12 tw:h-30" title="Клавиши">Активность</div>
      <div class="l-calls tw:flex tw:items-center tw:py-0 tw:px-12 tw:h-24">Созвоны</div>
    </div>

    <div
      ref="canvas"
      class="canvas tw:relative tw:flex-1 tw:min-w-0"
      @wheel.prevent="userWheel"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="drag = undefined"
      @pointerleave="hoverT = undefined"
      @pointerdown.capture="onMiddleDown"
      @mousedown.middle.prevent
      @contextmenu.prevent="onContext"
    >
      <!-- axis (drag to pan) -->
      <div class="axis tw:relative tw:h-30 tw:border-b tw:border-b-border tw:cursor-grab tw:overflow-hidden tw:active:cursor-grabbing" title="Колесо" @pointerdown="onAxisDown">
        <i v-for="t in axis.minor" :key="`m${t}`" class="div minor tw:absolute tw:bottom-0 tw:w-1 tw:pointer-events-none tw:h-3 tw:bg-white/18" :style="{ left: `${pct(t)}%` }"></i>
        <i v-for="t in axis.all" :key="`M${t}`" class="div tw:absolute tw:bottom-0 tw:w-1 tw:h-6 tw:bg-white/35 tw:pointer-events-none" :style="{ left: `${pct(t)}%` }"></i>
        <span v-for="t in axis.list" :key="t" class="tick tw:absolute tw:top-9 tw:[transform:translateX(-50%)] tw:text-[11px] tw:text-muted tw:tabular-nums tw:font-data tw:whitespace-nowrap" :style="{ left: `${pct(t)}%` }">{{ formatHM(t) }}</span>
        <span v-for="m in axis.marks" :key="m.text" class="tick mark tw:absolute tw:[transform:translateX(-50%)] tw:text-[11px] tw:text-muted tw:tabular-nums tw:font-data tw:whitespace-nowrap tw:font-semibold tw:py-1 tw:px-6 tw:top-7 tw:rounded-r2 tw:[&.sch]:not-[&.lunch]:text-accent-fg tw:[&.sch]:not-[&.lunch]:bg-accent/18 tw:[&.lunch]:text-(--lunch-mark-text) tw:[&.lunch]:bg-[color-mix(in_srgb,var(--lunch-mark)_18%,transparent)] tw:[&.lunch]:h-6" :class="m.cls" :style="{ left: `${pct(m.t)}%` }">{{ m.text }}</span>
        <span v-if="now && now >= from && now <= to" class="now-chip tw:absolute tw:top-5 tw:[transform:translateX(-50%)] tw:py-2 tw:px-8 tw:rounded-r2 tw:bg-down tw:text-text-hi tw:text-[11px] tw:font-semibold tw:whitespace-nowrap tw:z-2" :style="{ left: `${pct(now)}%` }">Сейчас {{ formatHM(now) }}</span>
      </div>

      <div class="lanes tw:relative">
        <div v-for="t in axis.list" :key="`g${t}`" class="gridline tw:absolute tw:top-0 tw:bottom-0 tw:w-1 tw:bg-white/5 tw:pointer-events-none" :style="{ left: `${pct(t)}%` }"></div>
        <div v-if="schedule.work" class="sch-work tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:bg-accent/9 tw:border-l-2 tw:border-l-accent/70 tw:border-r-2 tw:border-r-accent/70" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
        <template v-if="schedule.work">
          <div v-if="schedule.work[0] > from" class="sch-off tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:bg-black/22" :style="box(from, schedule.work[0], 0)"></div>
          <div v-if="schedule.work[1] < to" class="sch-off tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:bg-black/22" :style="box(schedule.work[1], to, 0)"></div>
        </template>
        <div v-if="schedule.lunch" class="sch-lunch tw:absolute tw:top-0 tw:bottom-0 tw:pointer-events-none tw:[background:repeating-linear-gradient(135deg,color-mix(in_srgb,var(--lunch-mark)_10%,transparent)_0_6px,color-mix(in_srgb,var(--lunch-mark)_3%,transparent)_6px_12px)] tw:border-l tw:[border-left-style:dashed] tw:border-l-[color-mix(in_srgb,var(--lunch-mark-fg)_55%,transparent)] tw:border-r tw:[border-right-style:dashed] tw:border-r-[color-mix(in_srgb,var(--lunch-mark-fg)_55%,transparent)]" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>

        <!-- the schedule; note pins -->
        <div class="lane sched tw:h-18 tw:relative">
          <div v-if="schedule.work" class="work tw:absolute tw:top-6 tw:h-6 tw:rounded-r2 tw:bg-accent/25" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
          <div v-if="schedule.lunch" class="lunch tw:absolute tw:top-6 tw:h-6 tw:rounded-r2 tw:bg-[color-mix(in_srgb,var(--lunch-mark)_55%,transparent)]" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>
          <div
            v-if="fanZone"
            class="fanzone tw:rounded-[4px] tw:bg-warn/8 tw:cursor-default tw:absolute"
            :style="{ left: `${fanZone.pct}%`, marginLeft: '-13px', top: '-2px', width: `${fanZone.width}px`, height: '22px', zIndex: 8 }"
            @pointerdown.stop
            @click.stop
            @dblclick.stop
            @pointerenter="fan.enter(fan.open.value!)"
            @pointerleave="fan.leave()"
          ></div>
          <span
            v-for="n in notePins"
            :key="n.id"
            class="notepin tw:top-1 tw:z-6 tw:inline-flex tw:items-center tw:justify-center tw:w-16 tw:h-16 tw:-ml-8 tw:rounded-r2 tw:bg-warn tw:text-bg tw:[box-shadow:0_1px_4px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:[transition:transform_0.18s_cubic-bezier(0.32,0.72,0,1)] tw:hover:bg-warn tw:[&.on]:[outline:2px_solid_var(--text-hi)] tw:absolute"
            :data-note="n.id"
            :style="{ left: `${pct(n.at)}%`, transform: fan.shift(pinPlaces.get(n.id)), zIndex: 8 + (pinPlaces.get(n.id)?.n ?? 1) - (pinPlaces.get(n.id)?.i ?? 0) }"
            @pointerenter="pinPlaces.get(n.id) && fan.enter(pinPlaces.get(n.id)!.key)"
            @pointerleave="fan.leave()"
            :title="noteTitle(n)"
            @pointerdown.stop
            :class="{ on: n.id === activeNoteId }"
            @click.stop="emit('note', n)"
          ><Icon :name="noteIcon(n)":size="11" :stroke="2.2" /></span>
        </div>

        <!-- day plan -->
        <div
          v-if="showPlan"
          ref="planLane"
          class="lane planl tw:border-t tw:[border-top-style:dashed] tw:border-t-white/6 tw:[transition:background_0.15s] tw:[&.active]:not-[&.dropping]:bg-accent/5 tw:[&.dropping]:bg-accent/16 tw:[&.dropping]:[box-shadow:inset_0_0_0_1px_rgb(var(--accent-rgb)/0.6)] tw:relative"
          :class="{ dropping: planDragging, active: planMode }"
          :style="{ height: `${planH}px` }"
        >
          <span v-if="planMode && !plan.length" class="phint tw:left-12 tw:top-8 tw:text-[11px] tw:text-accent-fg tw:pointer-events-none tw:absolute">Перетащите сюда вид занятости или задачу из панели «План дня»</span>
          <div
            v-for="p in planShown"
            :key="p.id"
            class="pseg tw:h-20 tw:flex tw:items-center tw:gap-4 tw:py-0 tw:px-6 tw:box-border tw:rounded-r2 tw:border-1.5 tw:border-dashed tw:border-(--c) tw:bg-[color-mix(in_srgb,var(--c)_22%,transparent)] tw:text-text tw:text-[11px] tw:overflow-hidden tw:whitespace-nowrap tw:cursor-grab tw:z-3 tw:[&.sel]:[box-shadow:0_0_0_2px_var(--text-hi)] tw:[&.moving]:opacity-85 tw:[&.moving]:cursor-grabbing tw:absolute tw:before:content-[''] tw:before:absolute tw:before:top-0 tw:before:bottom-0 tw:before:w-6 tw:before:cursor-ew-resize tw:before:left-0 tw:after:content-[''] tw:after:absolute tw:after:top-0 tw:after:bottom-0 tw:after:w-6 tw:after:cursor-ew-resize tw:after:right-0"
            :class="{ sel: p.id === selectedPlanId, moving: planDrag?.id === p.id && planDrag.moved }"
            :style="{ ...box(p.start, p.end), top: `${4 + (planRowOf.get(p.id) ?? 0) * PLAN_ROW}px`, '--c': kindColor(p.kind) }"
            :title="`План: ${p.task ? p.task.key + ' ' : ''}${p.label} · ${formatHM(p.start)}–${formatHM(p.end)} · ${formatDuration(p.end - p.start)}`"
            :data-plan="p.id"
            @pointerdown.stop="$event.button === 0 && onPlanDown($event, p)"
            @contextmenu.prevent.stop="openPlanMenu($event, p)"
          >
            <Icon v-if="planDoneIds.has(p.id)" name="check" :size="11" :stroke="3" class="pdone tw:[&&]:flex-none tw:text-up" />
            <Icon :name="entryIcon(p)" :size="12" :stroke="2.2" class="sic tw:ml-2 tw:opacity-95" />
            <span class="txt tw:overflow-hidden tw:text-ellipsis tw:flex-1 tw:min-w-0 tw:py-0 tw:px-8 tw:whitespace-nowrap tw:[&&]:pl-4!"><b v-if="p.task" class="pkey tw:mr-4 tw:font-semibold">{{ p.task.key }}</b>{{ p.task ? labelWithoutKey(p.label, p.task.key) : p.label }}</span>
          </div>
        </div>

        <!-- main line -->
        <div ref="mainLane" class="lane mainl tw:h-46 tw:[transition:height_0.25s_cubic-bezier(0.32,0.72,0,1)] tw:overflow-hidden tw:relative" :style="{ height: `${mainH}px` }" @pointerdown="onLaneDown($event)" @scroll="laneScroll = ($event.target as HTMLElement).scrollTop">
          <span v-if="hiddenBelow" class="lmore dn tw:right-6 tw:z-6 tw:py-0 tw:px-7 tw:rounded-[9px] tw:[background:var(--pop)] tw:[box-shadow:0_0_0_1px_var(--border-2)] tw:text-muted tw:text-[10.5px] tw:leading-[17px] tw:pointer-events-none tw:absolute" :style="{ top: `${laneScroll + mainH - 20}px` }" title="Ctrl + колесо мыши — прокрутить дорожки">ещё {{ hiddenBelow }} ↓ · Ctrl+колесо</span>
          <span v-if="hiddenAbove" class="lmore up tw:right-6 tw:z-6 tw:py-0 tw:px-7 tw:rounded-[9px] tw:[background:var(--pop)] tw:[box-shadow:0_0_0_1px_var(--border-2)] tw:text-muted tw:text-[10.5px] tw:leading-[17px] tw:pointer-events-none tw:absolute" :style="{ top: `${laneScroll + 2}px` }" title="Ctrl + колесо мыши — прокрутить дорожки">ещё {{ hiddenAbove }} ↑</span>
          <div class="lane-spacer tw:static! tw:pointer-events-none" :style="{ height: `${mainInnerH}px` }"></div>
          <div v-for="l in shownLanes" :key="`lane${l}`" class="lane-bg tw:left-0 tw:right-0 tw:rounded-[4px] tw:bg-white/2.5 tw:pointer-events-none tw:absolute" :style="{ top: `${5 + (l - 1) * (laneH + LANE_GAP)}px`, height: `${laneH}px` }"></div>
          <div
            v-for="e in main"
            :key="e.id"
            class="seg tw:group/seg tw:absolute tw:[background:var(--c)] tw:text-text-hi tw:text-[12px] tw:[transition:filter_0.15s,box-shadow_0.15s] tw:hover:filter-[brightness(1.12)] tw:cursor-grab tw:[&.moving]:cursor-grabbing tw:[&.moving]:not-[&.selected]:z-4 tw:[&.moving]:not-[&.multi]:not-[&.selected]:[box-shadow:0_6px_18px_rgba(0,0,0,0.5)] tw:[&.multi]:not-[&.selected]:[box-shadow:0_0_0_2px_var(--warn),0_0_10px_color-mix(in_srgb,var(--warn)_35%,transparent)] tw:[&.selected]:[box-shadow:0_0_0_2px_var(--text-hi),0_4px_14px_rgba(0,0,0,0.45)] tw:[&.selected]:z-3 tw:[&.ai]:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.13)_0_5px,transparent_5px_10px)] tw:[&.ghost]:z-4 tw:[&.ghost]:opacity-85 tw:[&.ghost]:pointer-events-none tw:[&.ghost]:[outline:1.5px_dashed_var(--text-hi)] tw:[&.ghost]:[box-shadow:0_6px_18px_rgba(0,0,0,0.5)]"
            :data-entry="e.id"
            :class="{ selected: e.id === selectedId, ai: e.source === 'ai', multi: multi.has(e.id), moving: drag?.type === 'move' && !drag.copy && drag.id === e.id && drag.moved, ghost: e.id === COPY_ID }"
            :style="{ ...box(preview(e).start, preview(e).end), '--c': kindColor(e.kind), ...laneStyle(e) }"
          >
            <span v-if="wide(e)" class="rh l tw:absolute tw:top-0 tw:bottom-0 tw:z-1 tw:w-6 tw:cursor-ew-resize tw:[transition:background_0.15s] tw:left-0 tw:rounded-[var(--r2)_0_0_var(--r2)] tw:group-hover/seg:not-group-[.selected]/seg:bg-white/35 tw:group-[.selected]/seg:bg-white/35" @pointerdown="onResizeDown($event, e, 'start')"></span>
            <!-- the icon starts the text; the text wraps to a second line only when it does not fit -->
            <span class="txt tw:flex-1 tw:min-w-0 tw:overflow-hidden tw:py-0 tw:px-3 tw:text-[10.5px] tw:leading-[12px] tw:whitespace-normal tw:[word-break:break-word] tw:text-clip tw:[display:-webkit-box] tw:[-webkit-line-clamp:2] tw:[-webkit-box-orient:vertical] tw:[&&]:pl-4!" :title="e.outlook ? `Встреча Outlook: ${e.label}` : undefined">
              <Icon :name="entryIcon(e)" :size="11" :stroke="2.4" class="sic tw:opacity-95 tw:[&&]:inline-block tw:mt-0 tw:mr-3 tw:mb-0 tw:ml-0 tw:[&&]:[vertical-align:-2px]" />
              <template v-if="e.outlook"><b class="tw:font-semibold">{{ e.label }}</b></template>
              <template v-else-if="e.task"><b class="tw:font-semibold">{{ e.task.key }}</b> {{ labelWithoutKey(e.label, e.task.key) }}</template>
              <template v-else>{{ e.label }}</template>
            </span>
            <span v-if="wide(e)" class="rh r tw:absolute tw:top-0 tw:bottom-0 tw:z-1 tw:w-6 tw:cursor-ew-resize tw:[transition:background_0.15s] tw:right-0 tw:rounded-[0_var(--r2)_var(--r2)_0] tw:group-hover/seg:not-group-[.selected]/seg:bg-white/35 tw:group-[.selected]/seg:bg-white/35" @pointerdown="onResizeDown($event, e, 'end')"></span>
          </div>
        </div>

        <!-- activity wave (per minute) -->
        <div class="lane pulsel tw:h-30 tw:relative">
          <ActivityWave class="dwave tw:left-0 tw:right-0 tw:top-5 tw:bottom-5 tw:pointer-events-none tw:absolute" mode="day" :rows="data.pulse ?? []" :day-start-ms="bounds[0]" :from="from" :to="to" :points="160" />
        </div>

        <!-- calls -->
        <div class="lane callsl tw:h-24 tw:relative" @pointerdown="onLaneDown($event)">
          <div
            v-for="(c, i) in calls"
            :key="i"
            class="call tw:absolute tw:[&.lunch]:h-6 tw:top-8 tw:bottom-8 tw:rounded-r2 tw:bg-(--call-mark)"
            :class="c.source"
            :data-range="`${c.start}:${c.end}`"
            :style="box(c.start, c.end, 0)"
          ></div>
        </div>

        <!-- selection band -->
        <div v-if="selection" class="band tw:absolute tw:-top-30 tw:bottom-0 tw:bg-accent/13 tw:border-l-2 tw:border-l-accent-fg tw:border-r-2 tw:border-r-accent-fg tw:pointer-events-none tw:z-4 tw:[transition:background_0.2s]" :style="box(selection.start, selEnd, 0)">
          <span class="cap l tw:absolute tw:top-4 tw:py-2 tw:px-6 tw:rounded-r2 tw:bg-accent-fg tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:cursor-ew-resize tw:pointer-events-auto tw:whitespace-nowrap tw:right-full tw:-mr-2 tw:[&&]:rounded-tr-none tw:[&&]:rounded-br-none" @pointerdown="onSelHandle($event, 'start')">{{ formatHM(selection.start) }}</span>
          <span class="cap r tw:absolute tw:top-4 tw:py-2 tw:px-6 tw:rounded-r2 tw:bg-accent-fg tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:cursor-ew-resize tw:pointer-events-auto tw:whitespace-nowrap tw:left-full tw:-ml-2 tw:[&&]:rounded-tl-none tw:[&&]:rounded-bl-none" @pointerdown="onSelHandle($event, 'end')">{{ selection.end ? formatHM(selEnd) : 'сейчас' }}</span>
          <span class="dur tw:absolute tw:bottom-2 tw:left-[50%] tw:[transform:translateX(-50%)] tw:text-[10px] tw:text-accent-fg tw:whitespace-nowrap">{{ formatDuration(selEnd - selection.start) }}</span>
        </div>

        <div v-if="now && now >= from && now <= to" class="nowline tw:absolute tw:top-0 tw:bottom-0 tw:w-2 tw:-ml-1 tw:bg-down tw:pointer-events-none tw:z-5" :style="{ left: `${pct(now)}%` }"></div>
        <button v-if="hidden.left" class="hid l tw:absolute tw:top-26 tw:z-8 tw:py-2 tw:px-8 tw:rounded-r2 tw:border-0 tw:bg-accent/90 tw:text-text-hi tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:[box-shadow:0_2px_8px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:hover:bg-accent tw:left-4 tw:hover:enabled:border-border-3" :title="`Скрыто слева: ${hidden.left}`" @pointerdown.stop @click="revealSide('left')">&lt;{{ hidden.left }}</button>
        <button v-if="hidden.right" class="hid r tw:absolute tw:top-26 tw:z-8 tw:py-2 tw:px-8 tw:rounded-r2 tw:border-0 tw:bg-accent/90 tw:text-text-hi tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:[box-shadow:0_2px_8px_rgba(0,0,0,0.5)] tw:cursor-pointer tw:hover:bg-accent tw:right-4 tw:hover:enabled:border-border-3" :title="`Скрыто справа: ${hidden.right}`" @pointerdown.stop @click="revealSide('right')">&gt;{{ hidden.right }}</button>
        <div v-if="pinT !== undefined && pinT >= from && pinT <= to" class="pinline tw:absolute tw:-top-30 tw:bottom-0 tw:w-2 tw:-ml-1 tw:bg-text-hi tw:pointer-events-none tw:z-6 tw:[box-shadow:0_0_6px_rgba(0,0,0,0.6)]" :style="{ left: `${pct(pinT)}%` }">
          <span class="tw:pointer-events-auto tw:cursor-ew-resize tw:absolute tw:top-4 tw:left-[50%] tw:[transform:translateX(-50%)] tw:py-2 tw:px-7 tw:rounded-r2 tw:bg-text-hi tw:text-panel tw:text-[11px] tw:font-bold tw:tabular-nums tw:font-data tw:whitespace-nowrap" title="Тяните влево или вправо" @pointerdown="onPinDown">{{ formatHM(pinT) }}</span>
        </div>
      </div>

    </div>
  </div>

  <div class="legend tw:flex tw:items-center tw:flex-wrap tw:gap-y-4 tw:gap-x-14 tw:mt-8 tw:py-0 tw:px-8 tw:text-[12px]">
    <span class="tw:inline-flex tw:items-center tw:gap-6" v-for="k in legend.kinds" :key="k"><i class="tw:w-8 tw:h-8 tw:rounded-[50%] tw:flex-none" :style="{ background: kindColor(k) }"></i>{{ kindLabel(k) }}</span>
    <span class="tw:inline-flex tw:items-center tw:gap-6" v-if="schedule.work"><i class="sq work tw:top-6 tw:w-8 tw:h-8 tw:flex-none tw:rounded-[2px] tw:bg-accent/35 tw:[box-shadow:inset_0_0_0_1px_var(--accent-fg)]"></i>Рабочее время</span>
    <span class="tw:inline-flex tw:items-center tw:gap-6" v-if="schedule.lunch"><i class="sq lunch tw:top-6 tw:w-8 tw:h-8 tw:flex-none tw:rounded-[2px] tw:bg-[color-mix(in_srgb,var(--lunch-mark)_40%,transparent)] tw:[box-shadow:inset_0_0_0_1px_var(--lunch-mark-fg)]"></i>Обед</span>
    <span class="spacer tw:inline-flex tw:items-center tw:gap-6 tw:flex-1"></span>
    <button
      v-if="follow && now !== undefined"
      class="ltog ico tw:inline-flex tw:items-center tw:gap-4 tw:py-2 tw:px-9 tw:rounded-r2 tw:border tw:border-border tw:bg-transparent tw:text-muted tw:text-[11px] tw:[&.on]:border-accent/60 tw:[&.on]:bg-accent/16 tw:[&.on]:text-text tw:hover:enabled:not-[&.on]:bg-hover tw:hover:enabled:not-[&.on]:border-border-3"
      :class="{ on: follow.follow }"
      title="Автопрокрутка"
      @click="toggleFollow"
    ><Icon name="follow" :size="13" /></button>
  </div>
  <KindMenu v-if="menu" :x="menu.x" :y="menu.y" :title="menu.title" :current="menu.current" :no-kinds="menu.outlook || !!menu.planId" @pick="onMenuPick" @close="menu = undefined">
    <template v-if="menu.planId">
      <button class="mact tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:border-border-3" :disabled="planDoneIds.has(menu.planId)" @click="planMenu('done')"><Icon name="check" :size="14" />{{ planDoneIds.has(menu.planId) ? 'Уже сделано по плану' : 'Сделано по плану' }}</button>
      <button class="mdel tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:border-border-3" @click="planMenu('delete')"><Icon name="trash" :size="14" />Удалить из плана</button>
    </template>
    <template v-else-if="menu.outlook">
      <p class="mnote tw:max-w-230 tw:mt-0 tw:mr-6 tw:mb-6 tw:ml-6 tw:text-muted tw:text-[11.5px] tw:leading-[1.4]">Время, название и вид меняет только Outlook. Напоминание — в карточке события.</p>
      <button class="mact tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:border-border-3" @click="(emit('select', menu.entryId!), (menu = undefined))"><Icon name="pencil" :size="14" />Открыть карточку</button>
    </template>
    <template v-if="menu.multi">
      <div class="msep tw:h-1 tw:m-4 tw:bg-border"></div>
      <button class="mact tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:border-border-3" @click="onMenuMerge"><Icon name="layers" :size="14" />Объединить</button>
      <button class="mdel tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:border-border-3" @click="onMenuDelete"><Icon name="trash" :size="14" />Удалить выбранные</button>
    </template>
    <template v-else-if="menu.entryId">
      <div class="msep tw:h-1 tw:m-4 tw:bg-border"></div>
      <button class="mact tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:border-border-3" title="Или перетащите блок с зажатым Ctrl" @click="copyAfterBlock"><Icon name="copy" :size="14" />Копия сразу после</button>
      <button class="mact tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:hover:bg-hover tw:hover:enabled:border-border-3" @click="copyBlockTo"><Icon name="calendar" :size="14" />Копия в дату и время…</button>
      <button class="mdel tw:flex tw:items-center tw:gap-8 tw:border-0 tw:bg-transparent tw:text-left tw:py-6 tw:px-8 tw:rounded-r2 tw:text-[13px] tw:text-down-fg tw:hover:bg-down/15 tw:hover:enabled:border-border-3" @click="onMenuDelete"><Icon name="trash" :size="14" />Удалить отрезок</button>
    </template>
  </KindMenu>
  <EntryCopyMenu v-if="copyOf" ref="copyMenu" no-button :day="data.day" :source="copyOf" @copied="(c, d) => emit('copied', c, d)" />
  </div>
</template>

<style scoped src="./Timeline.css"></style>
