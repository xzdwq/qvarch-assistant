<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { noteEntry, visibleNotes } from '@shared/notes'
import { labelWithoutKey } from '@shared/jira'
import { PLAN_STEP, planRows, snapPlan } from '@shared/plan'
import { formatDuration, formatHM, HOUR, laneIsFree, layoutLanes, MINUTE, sortByStart } from '@shared/timeline'
import type { DayData, Entry, Ms, Note, PlanBlock, Selection } from '@shared/types'
import { clusterize, useFan } from '../lib/pinfan'
import type { UiPrefs } from '@shared/types'
import { entryIcon, kindColor, kindLabel } from '../lib/palette'
import Icon from './Icon.vue'
import ActivityWave from './ActivityWave.vue'
import KindMenu from './KindMenu.vue'
import { pctOf, rememberedViews, segBox, snap, ticks, useViewport, visible } from '../lib/viewport'

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
/** Notes at (almost) the same moment spread apart on hover. */
const fan = useFan()
const pinPlaces = computed(() => clusterize(notePins.value, (n) => (pct(n.at) / 100) * width.value, 15))
const fanZone = computed(() => {
  const k = fan.open.value
  const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
  const p = k && notePins.value.find((x) => x.id === k)
  return p && n > 1 ? { pct: pct(p.at), width: (n - 1) * 19 + 26 } : undefined
})

/** Ctrl+click multi-selection. */
const multi = ref<Set<string>>(new Set())
/** The time divider placed by a click. */
const pinT = ref<Ms>()
watch(pinT, (t) => emit('pin', t))

// ---------- right-click menu ----------

const menu = ref<{ x: number; y: number; entryId?: string; multi?: boolean; title: string; current?: string; outlook?: boolean; planId?: string }>()
/** Plan blocks already turned into real ones (their block still exists). */
const planDoneIds = computed(() => new Set((props.data.plan ?? []).filter((p) => p.doneEntryId && props.data.entries.some((e) => e.id === p.doneEntryId)).map((p) => p.id)))
function openPlanMenu(e: MouseEvent, p: { id: string }): void {
  menu.value = { x: e.clientX, y: e.clientY, title: 'План', planId: p.id }
}
async function planMenu(action: 'done' | 'delete'): Promise<void> {
  const id = menu.value?.planId
  menu.value = undefined
  if (!id) return
  if (action === 'done') await window.qa.planDone(props.data.day, id)
  else await window.qa.deletePlan(props.data.day, id)
  emit('planChanged')
}

function onContext(e: MouseEvent): void {
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
  const id = under?.closest<HTMLElement>('[data-entry]')?.dataset.entry
  if (multi.value.size >= 2 && (!id || multi.value.has(id))) {
    menu.value = { x: e.clientX, y: e.clientY, multi: true, title: `Выбрано блоков: ${multi.value.size}` }
    return
  }
  if (id) {
    const entry = props.data.entries.find((x) => x.id === id)
    if (entry?.outlook) {
      menu.value = { x: e.clientX, y: e.clientY, entryId: id, title: 'Встреча из Outlook', outlook: true }
      return
    }
    menu.value = { x: e.clientX, y: e.clientY, entryId: id, title: 'Изменить вид', current: entry?.kind }
    return
  }
  const t = timeAt(e.clientX, false)
  const s = props.selection
  if (!s || t < s.start || t > selEnd.value) {
    const g = gapAround(t)
    if (g.end - g.start < MINUTE) return
    emit('selection', makeSel(g.start, g.end), true)
  }
  menu.value = { x: e.clientX, y: e.clientY, title: 'Отметить как' }
}

/** The free stretch around a moment: from the block before it to the block after it (or the day's edges / now). */
function gapAround(t: Ms): { start: Ms; end: Ms } {
  let start = props.bounds[0]
  let end = limit.value
  for (const e of props.data.entries) {
    if (e.end <= t && e.end > start) start = e.end
    if (e.start >= t && e.start < end) end = e.start
    // inside a block: no gap
    if (e.start < t && e.end > t) return { start: t, end: t }
  }
  return { start, end: Math.max(start, end) }
}

function onMenuDelete(): void {
  const m = menu.value
  menu.value = undefined
  const ids = m?.multi ? [...multi.value] : m?.entryId ? [m.entryId] : []
  for (const id of ids) emit('deleteEntry', id)
  multi.value = new Set()
}

function onMenuMerge(): void {
  menu.value = undefined
  emit('merge', [...multi.value])
  multi.value = new Set()
}

function onMenuPick(kind: string): void {
  const m = menu.value
  menu.value = undefined
  if (!m) return
  if (m.multi) for (const id of multi.value) emit('changeKind', { id, kind })
  else if (m.entryId) emit('changeKind', { id: m.entryId, kind })
  else emit('cutAs', kind)
}

const vp = useViewport({ bounds: () => props.bounds, initial: () => props.initial })
const from = vp.from
const to = vp.to

// ---------- following the time ----------
// every stepSec the window moves so "now" stands leftPx from the left; a manual move pauses it,
// idleSec after the last one it comes back (and jumps to now at once)
let applying = false
let lastManual = 0
let lastApply = 0
let stale = true
function applyFollow(instant = false, keepSpan?: number): void {
  const f = props.follow
  const el = canvas.value
  if (!f || !el || props.now === undefined) return
  const w = el.clientWidth || 1
  const span = f.zoom === 'fixed' ? f.spanMin * MINUTE : (keepSpan ?? to.value - from.value)
  const a = Date.now() - (Math.min(f.leftPx, w - 20) / w) * span
  applying = true
  if (instant) vp.setRange([a, a + span])
  else vp.glideTo([a, a + span])
  void nextTick(() => (applying = false))
  lastApply = Date.now()
  stale = false
}
/** The user moved / zoomed the timeline: following pauses. */
function markManual(): void {
  lastManual = Date.now()
  stale = true
}
const userWheel = (e: WheelEvent) => {
  markManual()
  vp.onWheel(e, canvas.value!)
}
watch(
  () => props.follow?.follow,
  (on) => {
    if (on) {
      lastManual = 0
      stale = true
      followTick()
    }
  },
)
/** The switch: on — to "now" at once (not after the first step). */
function toggleFollow(): void {
  const on = !props.follow?.follow
  if (on) {
    lastManual = 0
    applyFollow()
  }
  emit('follow', on)
}
// the window is remembered (a section switched away and back shows it as it was)
// the width settles after mounting (a dashboard widget): "now" is put back at its offset
let followRo: ResizeObserver | undefined
onMounted(() => {
  let lastW = 0
  followRo = new ResizeObserver(() => {
    const w = canvas.value?.clientWidth ?? 0
    if (Math.abs(w - lastW) < 2) return
    lastW = w
    if (props.follow?.follow && Date.now() - lastManual >= (props.follow.idleSec ?? 10) * 1000) applyFollow(true, to.value - from.value)
  })
  if (canvas.value) followRo.observe(canvas.value)
})
onBeforeUnmount(() => followRo?.disconnect())
onMounted(() => {
  const r = props.viewKey ? rememberedViews.get(props.viewKey) : undefined
  // following: straight to "now" at the remembered scale — no whole-day flash on coming back
  if (props.follow?.follow) applyFollow(true, r ? r[1] - r[0] : undefined)
  else if (r) vp.setRange(r)
})
watch([from, to], ([a, b]) => {
  if (props.viewKey && vp.zoomed.value && !applying) rememberedViews.set(props.viewKey, [a, b])
})
function followTick(): void {
  const f = props.follow
  if (!f?.follow || props.now === undefined) return
  if (Date.now() - lastManual < f.idleSec * 1000) return
  if (stale || Date.now() - lastApply >= f.stepSec * 1000) applyFollow()
}
const followTimer = setInterval(followTick, 1000)
onBeforeUnmount(() => clearInterval(followTimer))

const canvas = ref<HTMLElement>()
const width = ref(1000)
const box = (a: Ms, b: Ms, gap = 1) => segBox(a, b, from.value, to.value, gap)
const pct = (t: Ms) => pctOf(t, from.value, to.value)
const limit = computed(() => props.now ?? Math.max(props.bounds[0], ...props.data.entries.map((e) => e.end)))

/** Ticks + official schedule marks; "Сейчас" and schedule labels win over ticks they would overlap. */
const axis = computed(() => {
  const a = ticks(from.value, to.value, Math.max(6, Math.floor(width.value / 70)))
  const px = (t: Ms) => (pct(t) / 100) * width.value
  const marks: Array<{ t: Ms; text: string; cls: string }> = []
  const w = props.schedule.work
  const l = props.schedule.lunch
  if (w) marks.push({ t: w[0], text: `Начало ${formatHM(w[0])}`, cls: 'sch' }, { t: w[1], text: `Конец ${formatHM(w[1])}`, cls: 'sch' })
  if (l) marks.push({ t: (l[0] + l[1]) / 2, text: `Обед ${formatHM(l[0])}–${formatHM(l[1])}`, cls: 'lunch' })
  const nowPx = props.now ? px(props.now) : undefined
  const visibleMarks = marks.filter((m) => m.t >= from.value && m.t <= to.value && (nowPx === undefined || Math.abs(px(m.t) - nowPx) > 90))
  const taken = [...(nowPx !== undefined ? [nowPx] : []), ...visibleMarks.map((m) => px(m.t))]
  // unlabeled divisions between labels: quarters for hour+ steps, halves otherwise
  const sub = a.step >= HOUR ? a.step / 4 : a.step / 2
  const minor: Ms[] = []
  for (let t = Math.ceil(from.value / sub) * sub; t <= to.value; t += sub) if (!a.list.includes(t)) minor.push(t)
  return { ...a, list: a.list.filter((t) => taken.every((p) => Math.abs(px(t) - p) > 56)), marks: visibleMarks, minor, all: a.list }
})

/** Quick notes in view, as pins on the schedule row; the tooltip carries the text and its block. */
const notePins = computed(() => visibleNotes(props.data.notes).filter((n) => n.at >= from.value && n.at <= to.value))
function noteTitle(n: Note): string {
  const e = noteEntry(n, props.data.entries)
  return `Заметка ${formatHM(n.at)}${e ? ` · ${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` «${e.label}»` : ''}` : ''}\n${n.text}`
}

/** Blocks scrolled/zoomed out of view, per side — "<N" / ">N"; a click brings the outermost one back. */
const hidden = computed(() => {
  const list = props.data.entries
  const left = list.filter((e) => e.end <= from.value)
  const right = list.filter((e) => e.start >= to.value)
  return {
    left: left.length,
    right: right.length,
    first: left.length ? Math.min(...left.map((e) => e.start)) : 0,
    last: right.length ? Math.max(...right.map((e) => e.end)) : 0,
  }
})
function revealSide(side: 'left' | 'right'): void {
  const pad = (to.value - from.value) * 0.03
  markManual()
  if (side === 'left') vp.panBy(hidden.value.first - pad - from.value)
  else vp.panBy(hidden.value.last + pad - to.value)
}
const main = computed(() => visible(sortByStart(props.data.entries), from.value, to.value))
/** Entries as shown right now (drag preview applied); the dragged block yields its lane to the others. */
const viewEntries = computed(() =>
  props.data.entries.map((e) => {
    const p = preview(e)
    return p === e ? e : { ...e, ...p }
  }),
)
const movingId = computed(() => (drag.value?.type === 'move' || drag.value?.type === 'resize' ? drag.value.id : pending.value?.id))
const lanes = computed(() => layoutLanes(viewEntries.value, movingId.value))
const laneOf = (id: string) => lanes.value.get(id)?.lane ?? 0
const mainLane = ref<HTMLElement>()
/** Parallel blocks get their own lanes: the "Работа" row grows up to 3 lanes, more lanes scroll. */
const laneH = computed(() => 36)
const LANE_GAP = 4
/** Lanes in use + one empty lane below (a drop target); up to 3 visible, more scroll. */
const totalLanes = computed(() => Math.max(1, ...[...lanes.value.values()].map((l) => l.lanes)))
const shownLanes = computed(() => totalLanes.value + 1)
const mainH = computed(() => 10 + Math.min(shownLanes.value, 3) * (laneH.value + LANE_GAP) - LANE_GAP)
const mainInnerH = computed(() => 10 + shownLanes.value * (laneH.value + LANE_GAP) - LANE_GAP)
function laneStyle(e: Entry): Record<string, string> {
  const l = lanes.value.get(e.id)
  return { top: `${5 + (l?.lane ?? 0) * (laneH.value + LANE_GAP)}px`, bottom: 'auto', height: `${laneH.value}px` }
}
const calls = computed(() => visible(props.data.calls, from.value, to.value))

const legend = computed(() => ({ kinds: [...new Set(main.value.map((e) => e.kind))] }))

// ---------- selection band ----------

const selEnd = computed(() => (props.selection ? (props.selection.end ?? props.now ?? limit.value) : 0))

// ---------- pointer ----------

type Drag =
  | { type: 'create'; x0: number; t0: Ms; t1: Ms; moved: boolean; hitId?: string; ctrl: boolean }
  | { type: 'sel'; edge: 'start' | 'end' }
  | { type: 'resize'; id: string; edge: 'start' | 'end'; start: Ms; end: Ms; x0: number; moved: boolean }
  | { type: 'move'; id: string; x0: number; y0: number; t0: Ms; offset: Ms; dur: Ms; start: Ms; lane: number; moved: boolean }
  | { type: 'pin'; x0: number; t0: Ms; moved: boolean }
  | { type: 'pan'; x0: number; from0: Ms; span: number; moved: boolean; middle?: boolean }

const drag = ref<Drag>()
const hoverT = ref<Ms>()
const hoverX = ref(0)

function rawTimeAt(clientX: number): Ms {
  const r = canvas.value!.getBoundingClientRect()
  width.value = r.width
  return from.value + ((clientX - r.left) / r.width) * (to.value - from.value)
}

const snapPoints = computed(() => {
  const pts: Ms[] = []
  for (const e of props.data.entries) pts.push(e.start, e.end)
  for (const c of props.data.calls) pts.push(c.start, c.end)
  if (props.now) pts.push(props.now)
  if (props.schedule.work) pts.push(...props.schedule.work)
  if (props.schedule.lunch) pts.push(...props.schedule.lunch)
  return pts
})

function timeAt(clientX: number, snapIt = true): Ms {
  const t = rawTimeAt(clientX)
  const v = snapIt ? snap(t, snapPoints.value, (to.value - from.value) / width.value) : t
  // planned blocks are allowed: anything up to the end of the day
  return Math.max(props.bounds[0], Math.min(v, props.bounds[1]))
}

// ---------- the day plan lane ----------
// Planned blocks live apart from what happened: their own lane, dashed, never in the stats.

const plan = computed(() => props.data.plan ?? [])
const showPlan = computed(() => !!props.planMode || plan.value.length > 0)
const PLAN_ROW = 24
/** A plan block being moved / resized (preview until release). */
const planDrag = ref<{ id: string; mode: 'move' | 'l' | 'r'; x0: number; t0: Ms; start: Ms; end: Ms; moved: boolean }>()
const planShown = computed(() => {
  const d = planDrag.value
  return d ? plan.value.map((p) => (p.id === d.id ? { ...p, start: d.start, end: d.end } : p)) : plan.value
})
const planRowOf = computed(() => planRows(planShown.value))
const planH = computed(() => Math.max(1, ...[...planRowOf.value.values()].map((r) => r + 1)) * PLAN_ROW + 8)

function onPlanDown(e: PointerEvent, p: PlanBlock): void {
  if (e.button !== 0) return
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mode = e.clientX - r.left < 7 ? 'l' : r.right - e.clientX < 7 ? 'r' : 'move'
  planDrag.value = { id: p.id, mode, x0: e.clientX, t0: rawTimeAt(e.clientX), start: p.start, end: p.end, moved: false }
  window.addEventListener('pointermove', onPlanMove)
  window.addEventListener('pointerup', onPlanUp, { once: true })
}
function onPlanMove(e: PointerEvent): void {
  const d = planDrag.value
  const p = d && plan.value.find((x) => x.id === d.id)
  if (!d || !p) return
  d.moved ||= Math.abs(e.clientX - d.x0) > 3
  if (!d.moved) return
  const delta = snapPlan(rawTimeAt(e.clientX) - d.t0)
  const [lo, hi] = props.bounds
  if (d.mode === 'move') {
    const start = Math.max(lo, Math.min(hi - (p.end - p.start), p.start + delta))
    d.start = start
    d.end = start + (p.end - p.start)
  } else if (d.mode === 'l') d.start = Math.max(lo, Math.min(p.end - PLAN_STEP, snapPlan(p.start + delta)))
  else d.end = Math.min(hi, Math.max(p.start + PLAN_STEP, snapPlan(p.end + delta)))
}
function onPlanUp(): void {
  window.removeEventListener('pointermove', onPlanMove)
  const d = planDrag.value
  planDrag.value = undefined
  if (!d) return
  if (d.moved) emit('planChange', { id: d.id, start: d.start, end: d.end })
  else emit('planSelect', d.id === props.selectedPlanId ? undefined : d.id)
}
const planLane = ref<HTMLElement>()
/** The plan time under a screen point, if it is over the plan lane (a drop from the plan palette). */
function planTimeAt(x: number, y: number): Ms | undefined {
  const r = planLane.value?.getBoundingClientRect()
  if (!r || x < r.left || x > r.right || y < r.top - 10 || y > r.bottom + 10) return undefined
  return Math.max(props.bounds[0], Math.min(props.bounds[1] - PLAN_STEP, snapPlan(rawTimeAt(x))))
}
defineExpose({ reset: vp.reset, planTimeAt, toggleFollow })

function capture(e: PointerEvent): void {
  canvas.value?.setPointerCapture(e.pointerId)
}

/** click → divider; press+drag on empty space (or Shift+drag anywhere) → range; drag a block → move it; Ctrl+click → multi-select */
function onLaneDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const t = timeAt(e.clientX)
  const id = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-entry]')?.dataset.entry
  const hit = id ? props.data.entries.find((x) => x.id === id) : undefined
  if (hit && !hit.outlook && !e.shiftKey && !e.ctrlKey) {
    const raw = rawTimeAt(e.clientX)
    drag.value = { type: 'move', id: hit.id, x0: e.clientX, y0: e.clientY, t0: raw, offset: raw - hit.start, dur: hit.end - hit.start, start: hit.start, lane: laneOf(hit.id), moved: false }
  } else drag.value = { type: 'create', x0: e.clientX, t0: t, t1: t, moved: false, hitId: hit?.id, ctrl: e.ctrlKey }
  capture(e)
}

/** The time chip of the divider: drag left/right to select from that moment (works over blocks too). */
function onPinDown(e: PointerEvent): void {
  if (e.button !== 0 || pinT.value === undefined) return
  e.stopPropagation()
  drag.value = { type: 'pin', x0: e.clientX, t0: pinT.value, moved: false }
  capture(e)
}

function onSelHandle(e: PointerEvent, edge: 'start' | 'end'): void {
  e.stopPropagation()
  drag.value = { type: 'sel', edge }
  capture(e)
}

function onResizeDown(e: PointerEvent, entry: Entry, edge: 'start' | 'end'): void {
  e.stopPropagation()
  // an Outlook meeting is Outlook's
  if (entry.outlook) return
  drag.value = { type: 'resize', id: entry.id, edge, start: entry.start, end: entry.end, x0: e.clientX, moved: false }
  capture(e)
}

/** Middle button held anywhere on the timeline: scroll horizontally. */
function onMiddleDown(e: PointerEvent): void {
  if (e.button !== 1) return
  e.preventDefault()
  e.stopPropagation()
  drag.value = { type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value, moved: false, middle: true }
  capture(e)
}

function onAxisDown(e: PointerEvent): void {
  drag.value = { type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value, moved: false }
  capture(e)
}

function makeSel(start: Ms, end: Ms): Selection {
  const followNow = !!props.now && Math.abs(props.now - end) < MINUTE
  return { day: props.data.day, start, end: followNow ? undefined : end }
}

function onMove(e: PointerEvent): void {
  const d = drag.value
  if (!d) {
    if (!canvas.value) return
    const r = canvas.value.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right) return (hoverT.value = undefined)
    // between the fanned-out notes: no time line behind them
    if ((e.target as HTMLElement | null)?.closest?.('.fanzone, [data-note]')) return (hoverT.value = undefined)
    hoverT.value = rawTimeAt(e.clientX)
    hoverX.value = e.clientX - r.left
    return
  }
  hoverT.value = undefined
  if (d.type === 'pan') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    const r = canvas.value!.getBoundingClientRect()
    const a = d.from0 + ((d.x0 - e.clientX) / r.width) * d.span
    markManual()
    vp.setRange([a, a + d.span])
    return
  }
  const t = timeAt(e.clientX)
  if (d.type === 'create') {
    d.t1 = t
    d.moved ||= Math.abs(e.clientX - d.x0) > 4
    if (d.moved) emit('selection', makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)), false)
  } else if (d.type === 'sel' && props.selection) {
    const s = props.selection
    const end = selEnd.value
    if (d.edge === 'start') emit('selection', { ...s, start: Math.min(t, end - MINUTE) }, false)
    else emit('selection', makeSel(s.start, Math.max(t, s.start + MINUTE)), false)
  } else if (d.type === 'resize') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    if (!d.moved) return
    if (d.edge === 'start') d.start = Math.min(t, d.end - MINUTE)
    else d.end = Math.max(t, d.start + MINUTE)
  } else if (d.type === 'pin') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    if (d.moved) emit('selection', makeSel(Math.min(d.t0, t), Math.max(d.t0, t)), false)
  } else if (d.type === 'move') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 4 || Math.abs(e.clientY - d.y0) > 6
    if (!d.moved) return
    const raw = rawTimeAt(e.clientX) - d.offset
    const snapped = snap(raw, snapPoints.value.filter((p) => p !== d.start), (to.value - from.value) / width.value)
    d.start = Math.max(props.bounds[0], Math.min(snapped, props.bounds[1] - d.dur))
    // vertical: the lane under the pointer (incl. the empty one below), only into a free slot
    const el = mainLane.value
    if (el && d.type === 'move') {
      const r = el.getBoundingClientRect()
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        const y = e.clientY - r.top + el.scrollTop - 5
        const want = Math.max(0, Math.min(Math.floor(y / (laneH.value + LANE_GAP)), totalLanes.value))
        if (want !== d.lane && laneIsFree(props.data.entries, want, d.start, d.start + d.dur, d.id)) d.lane = want
      }
    }
  }
}

function onUp(e: PointerEvent): void {
  const d = drag.value
  // the lane a moved block is shown on comes from the live preview — read it before the drag is cleared
  const dropLane = d?.type === 'move' ? laneOf(d.id) : 0
  drag.value = undefined
  if (!d) return
  if (d.type === 'pin') {
    if (!d.moved) return
    pinT.value = undefined
    if (props.selection) emit('selection', props.selection, true)
    return
  }
  if (d.type === 'move') {
    if (!d.moved) return clickBlock(d.id, d.t0)
    const lane = dropLane // the lane it is shown on is the lane it keeps
    pending.value = { id: d.id, start: d.start, end: d.start + d.dur, lane }
    setTimeout(() => pending.value?.id === d.id && (pending.value = undefined), 2000)
    return emit('move', { id: d.id, start: d.start, end: d.start + d.dur, lane })
  }
  if (d.type === 'resize') {
    // a click on the edge of a narrow block still selects it
    if (!d.moved) return clickBlock(d.id, d.edge === 'start' ? d.start : d.end)
    // keep the new size on screen until the saved state comes back — no snap-back flicker
    pending.value = { id: d.id, start: d.start, end: d.end }
    setTimeout(() => pending.value?.id === d.id && (pending.value = undefined), 2000)
    return emit('resize', { id: d.id, start: d.start, end: d.end })
  }
  if (d.type === 'pan') {
    // a plain (left) click on the time axis drops the marker
    if (!d.moved && !d.middle) emit('selection', null, true)
    return
  }
  if (d.type === 'sel') {
    if (props.selection) emit('selection', props.selection, true)
    return
  }
  if (d.type !== 'create') return
  if (d.moved) {
    pinT.value = undefined
    multi.value = new Set()
    return emit('selection', makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)), true)
  }
  // plain click: Ctrl → multi-select; a block → highlight it (or, with a selection, copy it); empty → divider + drop the selection
  if (d.hitId && d.ctrl) return toggleMulti(d.hitId)
  if (d.hitId) return clickBlock(d.hitId, d.t0)
  multi.value = new Set()
  pinT.value = d.t0
  emit('selection', null, true)
}

function clickBlock(id: string, t: Ms): void {
  multi.value = new Set()
  if (!props.selection) pinT.value = t
  emit('select', id)
}

function toggleMulti(id: string): void {
  const s = new Set(multi.value)
  if (props.selectedId && !s.size) s.add(props.selectedId)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  multi.value = s
}

function onKey(e: KeyboardEvent): void {
  const s = props.selection
  if (e.key === 'Escape') {
    multi.value = new Set()
    pinT.value = undefined
    return emit('selection', null, true)
  }
  if (!s || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  const delta = (e.key === 'ArrowLeft' ? -1 : 1) * (e.altKey ? 5 : 1) * MINUTE
  if (e.shiftKey) emit('selection', { ...s, start: Math.min(s.start + delta, selEnd.value - MINUTE) }, true)
  else emit('selection', makeSel(s.start, Math.min(Math.max(selEnd.value + delta, s.start + MINUTE), props.bounds[1])), true)
}

const pending = ref<{ id: string; start: Ms; end: Ms; lane?: number }>()
watch(
  () => props.data.entries,
  (list) => {
    const p = pending.value
    if (p && list.some((e) => e.id === p.id && e.start === p.start && e.end === p.end && (p.lane === undefined || e.lane === p.lane)))
      pending.value = undefined
  },
)

function preview(e: Entry): { start: Ms; end: Ms; lane?: number } | Entry {
  const d = drag.value
  if (d?.type === 'resize' && d.id === e.id && d.moved) return { start: d.start, end: d.end }
  if (d?.type === 'move' && d.id === e.id && d.moved) return { start: d.start, end: d.start + d.dur, lane: d.lane }
  const p = pending.value
  return p && p.id === e.id ? { start: p.start, end: p.end, lane: p.lane ?? e.lane } : e
}

/** Resize handles only where there is room — otherwise the whole block is a click target. */
const wide = (e: Entry) => ((preview(e).end - preview(e).start) / (to.value - from.value)) * width.value >= 26

</script>

<template>
  <div class="root">
  <div class="tl" tabindex="0" @keydown="onKey">
    <div class="labels">
      <div class="l-axis"></div>
      <div class="l-sched">График</div>
      <div v-if="showPlan" class="l-plan" :style="{ height: `${planH}px` }">План</div>
      <div class="l-main" :style="{ height: `${mainH}px` }">Работа</div>
      <div class="l-pulse" title="Клавиши">Активность</div>
      <div class="l-calls">Созвоны</div>
    </div>

    <div
      ref="canvas"
      class="canvas"
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
      <div class="axis" title="Колесо" @pointerdown="onAxisDown">
        <i v-for="t in axis.minor" :key="`m${t}`" class="div minor" :style="{ left: `${pct(t)}%` }"></i>
        <i v-for="t in axis.all" :key="`M${t}`" class="div" :style="{ left: `${pct(t)}%` }"></i>
        <span v-for="t in axis.list" :key="t" class="tick" :style="{ left: `${pct(t)}%` }">{{ formatHM(t) }}</span>
        <span v-for="m in axis.marks" :key="m.text" class="tick mark" :class="m.cls" :style="{ left: `${pct(m.t)}%` }">{{ m.text }}</span>
        <span v-if="now && now >= from && now <= to" class="now-chip" :style="{ left: `${pct(now)}%` }">Сейчас {{ formatHM(now) }}</span>
      </div>

      <div class="lanes">
        <div v-for="t in axis.list" :key="`g${t}`" class="grid" :style="{ left: `${pct(t)}%` }"></div>
        <div v-if="schedule.work" class="sch-work" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
        <template v-if="schedule.work">
          <div v-if="schedule.work[0] > from" class="sch-off" :style="box(from, schedule.work[0], 0)"></div>
          <div v-if="schedule.work[1] < to" class="sch-off" :style="box(schedule.work[1], to, 0)"></div>
        </template>
        <div v-if="schedule.lunch" class="sch-lunch" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>

        <!-- the schedule; note pins -->
        <div class="lane sched">
          <div v-if="schedule.work" class="work" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
          <div v-if="schedule.lunch" class="lunch" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>
          <div
            v-if="fanZone"
            class="fanzone"
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
            class="notepin"
            :data-note="n.id"
            :style="{ left: `${pct(n.at)}%`, transform: fan.shift(pinPlaces.get(n.id)), zIndex: 8 + (pinPlaces.get(n.id)?.n ?? 1) - (pinPlaces.get(n.id)?.i ?? 0) }"
            @pointerenter="pinPlaces.get(n.id) && fan.enter(pinPlaces.get(n.id)!.key)"
            @pointerleave="fan.leave()"
            :title="noteTitle(n)"
            @pointerdown.stop
            :class="{ on: n.id === activeNoteId }"
            @click.stop="emit('note', n)"
          ><Icon :name="n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note'" :size="11" :stroke="2.2" /></span>
        </div>

        <!-- day plan -->
        <div
          v-if="showPlan"
          ref="planLane"
          class="lane planl"
          :class="{ dropping: planDragging, active: planMode }"
          :style="{ height: `${planH}px` }"
        >
          <span v-if="planMode && !plan.length" class="phint">Перетащите сюда вид занятости или задачу из панели «План дня»</span>
          <div
            v-for="p in planShown"
            :key="p.id"
            class="pseg"
            :class="{ sel: p.id === selectedPlanId, moving: planDrag?.id === p.id && planDrag.moved }"
            :style="{ ...box(p.start, p.end), top: `${4 + (planRowOf.get(p.id) ?? 0) * PLAN_ROW}px`, '--c': kindColor(p.kind) }"
            :title="`План: ${p.task ? p.task.key + ' ' : ''}${p.label} · ${formatHM(p.start)}–${formatHM(p.end)} · ${formatDuration(p.end - p.start)}`"
            :data-plan="p.id"
            @pointerdown.stop="$event.button === 0 && onPlanDown($event, p)"
            @contextmenu.prevent.stop="openPlanMenu($event, p)"
          >
            <Icon v-if="planDoneIds.has(p.id)" name="check" :size="11" :stroke="3" class="pdone" />
            <Icon :name="entryIcon(p)" :size="12" :stroke="2.2" class="sic" />
            <span class="txt"><b v-if="p.task" class="pkey">{{ p.task.key }}</b>{{ p.task ? labelWithoutKey(p.label, p.task.key) : p.label }}</span>
          </div>
        </div>

        <!-- main line -->
        <div ref="mainLane" class="lane mainl" :style="{ height: `${mainH}px` }" @pointerdown="onLaneDown($event)">
          <div class="lane-spacer" :style="{ height: `${mainInnerH}px` }"></div>
          <div v-for="l in shownLanes" :key="`lane${l}`" class="lane-bg" :style="{ top: `${5 + (l - 1) * (laneH + LANE_GAP)}px`, height: `${laneH}px` }"></div>
          <div
            v-for="e in main"
            :key="e.id"
            class="seg"
            :data-entry="e.id"
            :class="{ selected: e.id === selectedId, ai: e.source === 'ai', multi: multi.has(e.id), moving: drag?.type === 'move' && drag.id === e.id && drag.moved }"
            :style="{ ...box(preview(e).start, preview(e).end), '--c': kindColor(e.kind), ...laneStyle(e) }"
          >
            <span v-if="wide(e)" class="rh l" @pointerdown="onResizeDown($event, e, 'start')"></span>
            <!-- the icon starts the text; the text wraps to a second line only when it does not fit -->
            <span class="txt" :title="e.outlook ? `Встреча Outlook: ${e.label}` : undefined">
              <Icon :name="entryIcon(e)" :size="11" :stroke="2.4" class="sic" />
              <template v-if="e.outlook"><b>{{ e.label }}</b></template>
              <template v-else-if="e.task"><b>{{ e.task.key }}</b> {{ labelWithoutKey(e.label, e.task.key) }}</template>
              <template v-else>{{ e.label }}</template>
            </span>
            <span v-if="wide(e)" class="rh r" @pointerdown="onResizeDown($event, e, 'end')"></span>
          </div>
        </div>

        <!-- activity wave (per minute) -->
        <div class="lane pulsel">
          <ActivityWave class="dwave" mode="day" :rows="data.pulse ?? []" :day-start-ms="bounds[0]" :from="from" :to="to" :points="160" />
        </div>

        <!-- calls -->
        <div class="lane callsl" @pointerdown="onLaneDown($event)">
          <div
            v-for="(c, i) in calls"
            :key="i"
            class="call"
            :class="c.source"
            :data-range="`${c.start}:${c.end}`"
            :style="box(c.start, c.end, 0)"
          ></div>
        </div>

        <!-- selection band -->
        <div v-if="selection" class="band" :style="box(selection.start, selEnd, 0)">
          <span class="cap l" @pointerdown="onSelHandle($event, 'start')">{{ formatHM(selection.start) }}</span>
          <span class="cap r" @pointerdown="onSelHandle($event, 'end')">{{ selection.end ? formatHM(selEnd) : 'сейчас' }}</span>
          <span class="dur">{{ formatDuration(selEnd - selection.start) }}</span>
        </div>

        <div v-if="now && now >= from && now <= to" class="nowline" :style="{ left: `${pct(now)}%` }"></div>
        <button v-if="hidden.left" class="hid l" :title="`Скрыто слева: ${hidden.left}`" @pointerdown.stop @click="revealSide('left')">&lt;{{ hidden.left }}</button>
        <button v-if="hidden.right" class="hid r" :title="`Скрыто справа: ${hidden.right}`" @pointerdown.stop @click="revealSide('right')">&gt;{{ hidden.right }}</button>
        <div v-if="pinT !== undefined && pinT >= from && pinT <= to" class="pinline" :style="{ left: `${pct(pinT)}%` }">
          <span title="Тяните влево или вправо" @pointerdown="onPinDown">{{ formatHM(pinT) }}</span>
        </div>
      </div>

    </div>
  </div>

  <div class="legend">
    <span v-for="k in legend.kinds" :key="k"><i :style="{ background: kindColor(k) }"></i>{{ kindLabel(k) }}</span>
    <span v-if="schedule.work"><i class="sq work"></i>Рабочее время</span>
    <span v-if="schedule.lunch"><i class="sq lunch"></i>Обед</span>
    <span class="spacer"></span>
    <button
      v-if="follow && now !== undefined"
      class="ltog ico"
      :class="{ on: follow.follow }"
      title="Автопрокрутка"
      @click="toggleFollow"
    ><Icon name="follow" :size="13" /></button>
  </div>
  <KindMenu v-if="menu" :x="menu.x" :y="menu.y" :title="menu.title" :current="menu.current" :no-kinds="menu.outlook || !!menu.planId" @pick="onMenuPick" @close="menu = undefined">
    <template v-if="menu.planId">
      <button class="mact" :disabled="planDoneIds.has(menu.planId)" @click="planMenu('done')"><Icon name="check" :size="14" />{{ planDoneIds.has(menu.planId) ? 'Уже сделано по плану' : 'Сделано по плану' }}</button>
      <button class="mdel" @click="planMenu('delete')"><Icon name="trash" :size="14" />Удалить из плана</button>
    </template>
    <template v-else-if="menu.outlook">
      <p class="mnote">Время, название и вид меняет только Outlook. Напоминание — в карточке события.</p>
      <button class="mact" @click="(emit('select', menu.entryId!), (menu = undefined))"><Icon name="pencil" :size="14" />Открыть карточку</button>
    </template>
    <template v-if="menu.multi">
      <div class="msep"></div>
      <button class="mact" @click="onMenuMerge"><Icon name="layers" :size="14" />Объединить</button>
      <button class="mdel" @click="onMenuDelete"><Icon name="trash" :size="14" />Удалить выбранные</button>
    </template>
    <template v-else-if="menu.entryId">
      <div class="msep"></div>
      <button class="mdel" @click="onMenuDelete"><Icon name="trash" :size="14" />Удалить отрезок</button>
    </template>
  </KindMenu>
  </div>
</template>

<style scoped>
.pdone {
  flex: none;
  color: var(--up);
}
.mhead {
  margin: 2px 8px 4px;
  color: var(--muted);
  font-size: 11px;
}
.mlab {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtime {
  margin-left: auto;
  padding-left: 10px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
}
.mnote {
  max-width: 230px;
  margin: 0 6px 6px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.tl {
  display: flex;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r3);
  user-select: none;
  outline: none;
  overflow: hidden;
}
.tl:focus-visible {
  border-color: var(--accent-soft);
}
.labels {
  flex: none;
  width: 104px;
  border-right: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
.labels > div {
  display: flex;
  align-items: center;
  padding: 0 12px;
}
.l-axis {
  height: 30px;
}
.l-sched,
.sched {
  height: 18px;
}
.planl {
  border-top: 1px dashed rgba(255, 255, 255, 0.06);
  transition: background 0.15s;
}
.planl.active {
  background: rgb(var(--accent-rgb) / 0.05);
}
.planl.dropping {
  background: rgb(var(--accent-rgb) / 0.16);
  box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.6);
}
.phint {
  left: 12px;
  top: 8px;
  font-size: 11px;
  color: var(--accent-fg);
  pointer-events: none;
}
/* planned — dashed, see-through: a plan, not what happened */
.pseg {
  height: 20px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: var(--r2);
  border: 1.5px dashed var(--c);
  background: color-mix(in srgb, var(--c) 22%, transparent);
  color: var(--text);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  cursor: grab;
  z-index: 3;
}
.pseg::before,
.pseg::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
}
.pseg::before {
  left: 0;
}
.pseg::after {
  right: 0;
}
.pseg.sel {
  box-shadow: 0 0 0 2px var(--text-hi);
}
.pseg.moving {
  opacity: 0.85;
  cursor: grabbing;
}
.pkey {
  margin-right: 4px;
}
.pseg .txt {
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-desc {
  margin: 2px 0 4px 14px;
  font-size: 12px;
  color: var(--text-2);
  white-space: pre-wrap;
  max-width: 320px;
}
.notepin {
  top: 1px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: -8px;
  border-radius: var(--r2);
  background: var(--warn);
  color: var(--bg);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.notepin {
  transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}
.notepin:hover {
  background: var(--warn);
}
/* under a fanned-out group of notes: the pointer may cross it without the group folding back */
.fanzone {
  position: absolute;
  border-radius: 4px;
  background: rgba(255, 183, 77, 0.08);
  cursor: default;
}
/* an invisible end for a linked block / note out of view */
.ghost-end {
  width: 1px;
  pointer-events: none;
}
.ltog {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.ltog.on {
  border-color: rgb(var(--accent-rgb) / 0.6);
  background: rgb(var(--accent-rgb) / 0.16);
  color: var(--text);
}
.l-main,
.mainl {
  height: 46px;
  transition: height 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.mainl {
  overflow-y: auto;
  overflow-x: hidden;
}
.mainl::-webkit-scrollbar {
  width: 4px;
}
.lane-bg {
  left: 0;
  right: 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.025);
  pointer-events: none;
}
.lane-spacer {
  position: static !important;
  pointer-events: none;
}
.l-main {
  color: var(--text);
  font-weight: 600;
}
.l-apps,
.appsl {
  height: 24px;
}
.l-calls,
.callsl {
  height: 24px;
}
.l-pulse,
.pulsel {
  height: 30px;
}
.dwave {
  left: 0;
  right: 0;
  top: 5px;
  bottom: 5px;
  pointer-events: none;
}
.notepin.on {
  outline: 2px solid var(--text-hi);
}
.canvas {
  position: relative;
  flex: 1;
  min-width: 0;
}
.axis {
  position: relative;
  height: 30px;
  border-bottom: 1px solid var(--border);
  cursor: grab;
  overflow: hidden;
}
.axis:active {
  cursor: grabbing;
}
.div {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 6px;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.div.minor {
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
}
.hid {
  position: absolute;
  top: 26px;
  z-index: 8;
  padding: 2px 8px;
  border-radius: var(--r2);
  border: 0;
  background: rgb(var(--accent-rgb) / 0.9);
  color: var(--text-hi);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.hid:hover {
  background: var(--accent);
}
.hid.l {
  left: 4px;
}
.hid.r {
  right: 4px;
}
.tick {
  position: absolute;
  top: 9px;
  transform: translateX(-50%);
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  white-space: nowrap;
}
.tick.mark {
  font-weight: 600;
  padding: 1px 6px;
  top: 7px;
  border-radius: var(--r2);
}
.tick.sch {
  color: var(--accent-fg);
  background: rgb(var(--accent-rgb) / 0.18);
}
.tick.lunch {
  color: #fed7aa;
  background: rgba(249, 115, 22, 0.18);
}
.sch-work,
.sch-lunch {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}
.sch-work {
  background: rgb(var(--accent-rgb) / 0.09);
  border-left: 2px solid rgb(var(--accent-rgb) / 0.7);
  border-right: 2px solid rgb(var(--accent-rgb) / 0.7);
}
/* outside the official hours — dimmed, so the work day stands out */
.sch-off {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.22);
}
.sch-lunch {
  background: repeating-linear-gradient(135deg, rgba(249, 115, 22, 0.1) 0 6px, rgba(249, 115, 22, 0.03) 6px 12px);
  border-left: 1px dashed rgba(253, 186, 116, 0.55);
  border-right: 1px dashed rgba(253, 186, 116, 0.55);
}
.now-chip {
  position: absolute;
  top: 5px;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: var(--r2);
  background: var(--down);
  color: var(--text-hi);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  z-index: 2;
}
.lanes {
  position: relative;
}
.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.05);
  pointer-events: none;
}
.off {
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0 6px, rgba(0, 0, 0, 0.18) 6px 12px);
  pointer-events: none;
}
.lane {
  position: relative;
}
.lane > * {
  position: absolute;
}
.mainl,
.appsl,
.callsl {
  cursor: crosshair;
}
.work {
  top: 6px;
  height: 6px;
  border-radius: var(--r2);
  background: rgb(var(--accent-rgb) / 0.25);
}
.lunch {
  top: 6px;
  height: 6px;
  border-radius: var(--r2);
  background: rgba(249, 115, 22, 0.55);
}
.pc {
  top: 13px;
  height: 3px;
  border-radius: 2px;
  background: var(--up);
}
.seg,
.uncut {
  top: 5px;
  bottom: 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  overflow: hidden;
  /* the text follows the block's own width (the same on the page and in the dashboard) */
  container-type: inline-size;
}
.ut {
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1.15;
  text-align: center;
}
@container (max-width: 139px) {
  .ut {
    flex-direction: column;
  }
  .us {
    display: none;
  }
}
@container (max-width: 83px) {
  .ul {
    display: none;
  }
}
@container (max-width: 33px) {
  .ut {
    display: none;
  }
}
.seg {
  background: var(--c);
  color: var(--text-hi);
  font-size: 12px;
  cursor: pointer;
  transition: filter 0.15s, box-shadow 0.15s;
}
.seg:hover {
  filter: brightness(1.12);
}
.seg {
  cursor: grab;
}
.seg.moving {
  cursor: grabbing;
  z-index: 4;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
.seg.multi {
  box-shadow:
    0 0 0 2px var(--warn),
    0 0 10px rgba(255, 183, 77, 0.35);
}
.pinline {
  position: absolute;
  top: -30px;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--text-hi);
  pointer-events: none;
  z-index: 6;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
}
.pinline span {
  pointer-events: auto;
  cursor: ew-resize;
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 7px;
  border-radius: var(--r2);
  background: var(--text-hi);
  color: var(--panel);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  white-space: nowrap;
}
.mact {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--r2);
  font-size: 13px;
}
.mact:hover {
  background: var(--hover);
}
.seg.selected {
  box-shadow: 0 0 0 2px var(--text-hi), 0 4px 14px rgba(0, 0, 0, 0.45);
  z-index: 3;
}
.seg.ai {
  background-image: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.13) 0 5px, transparent 5px 10px);
}
.seg.small {
  top: 4px;
  bottom: 4px;
  border-radius: var(--r2);
  font-size: 11px;
}
.txt {
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* a block's text: up to two small lines, the icon inline at its start */
.seg > .txt {
  padding: 0 3px;
  font-size: 10.5px;
  line-height: 12px;
  white-space: normal;
  word-break: break-word;
  text-overflow: clip;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.txt b {
  font-weight: 600;
}
/* resize handles lie over the block's edges — they take no room from the text */
.rh {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  width: 6px;
  cursor: ew-resize;
  transition: background 0.15s;
}
.rh.l {
  left: 0;
  border-radius: var(--r2) 0 0 var(--r2);
}
.rh.r {
  right: 0;
  border-radius: 0 var(--r2) var(--r2) 0;
}
.xlink {
  position: absolute;
  right: 3px;
  top: 2px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border-radius: var(--r2);
  background: rgba(13, 17, 23, 0.55);
  color: var(--accent-fg);
  font-size: 9.5px;
  line-height: 13px;
  cursor: pointer;
}
.xlink:hover {
  background: rgb(var(--accent-rgb) / 0.85);
  color: var(--text-hi);
}
.seg:hover .rh,
.seg.selected .rh {
  background: rgba(255, 255, 255, 0.35);
}
.sic {
  margin-left: 2px;
  opacity: 0.95;
}
.seg > .txt .sic {
  display: inline-block;
  margin: 0 3px 0 0;
  vertical-align: -2px;
}
.txt {
  padding-left: 4px !important;
}
.uncut {
  background: repeating-linear-gradient(135deg, rgba(127, 139, 157, 0.3) 0 6px, rgba(127, 139, 157, 0.1) 6px 12px);
  background-size: 17px 17px;
  animation: flow 1.4s linear infinite;
  color: var(--text-2);
  font-size: 11px;
  justify-content: center;
  white-space: nowrap;
}
@keyframes flow {
  to {
    background-position: 17px 0;
  }
}
.app {
  top: 6px;
  bottom: 6px;
  opacity: 0.9;
}
.app:hover {
  opacity: 1;
  outline: 1px solid rgba(255, 255, 255, 0.6);
  z-index: 1;
}
.app.idle,
.app.locked {
  background: repeating-linear-gradient(90deg, var(--border-3) 0 2px, transparent 2px 4px);
}
.call {
  top: 8px;
  bottom: 8px;
  border-radius: var(--r2);
  background: #14b8a6;
}
.call.presence {
  background: var(--accent-fg);
}
.band {
  position: absolute;
  top: -30px;
  bottom: 0;
  background: rgb(var(--accent-rgb) / 0.13);
  border-left: 2px solid var(--accent-fg);
  border-right: 2px solid var(--accent-fg);
  pointer-events: none;
  z-index: 4;
  transition: background 0.2s;
}
.cap {
  position: absolute;
  top: 4px;
  padding: 2px 6px;
  border-radius: var(--r2);
  background: var(--accent-fg);
  color: var(--panel);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: var(--font-data);
  cursor: ew-resize;
  pointer-events: auto;
  white-space: nowrap;
}
.cap.l {
  right: 100%;
  margin-right: -2px;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.cap.r {
  left: 100%;
  margin-left: -2px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.dur {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: var(--accent-fg);
  white-space: nowrap;
}
.nowline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--down);
  pointer-events: none;
  z-index: 5;
}
.hoverline {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
  z-index: 5;
}
.card {
  position: absolute;
  top: 34px;
  margin-left: 12px;
  width: 300px;
  padding: 8px 10px;
  background: rgba(13, 17, 23, 0.97);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
  font-size: 12px;
  pointer-events: none;
  z-index: 10;
  animation: fade 0.12s ease-out;
}
.card.flip {
  margin-left: -312px;
}
@keyframes fade {
  from {
    opacity: 0;
  }
}
.c-time {
  font-weight: 700;
  margin-bottom: 4px;
}
.c-time .muted {
  font-weight: 400;
  margin-left: 6px;
}
.c-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 3px;
}
.c-row i,
.legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.c-row .muted {
  margin-left: auto;
}
.c-title {
  margin: 2px 0 0 14px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c-hint {
  margin-top: 6px;
  font-size: 11px;
}
.msep {
  height: 1px;
  margin: 4px;
  background: var(--border);
}
.mdel {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--r2);
  font-size: 13px;
  color: var(--down-fg);
}
.mdel:hover {
  background: rgba(255, 61, 61, 0.15);
}
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 8px;
  font-size: 12px;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend .app-l {
  color: var(--muted);
}
.legend i.sq {
  border-radius: 2px;
}
.legend i.sq.work {
  background: rgb(var(--accent-rgb) / 0.35);
  box-shadow: inset 0 0 0 1px var(--accent-fg);
}
.legend i.sq.lunch {
  background: rgba(249, 115, 22, 0.4);
  box-shadow: inset 0 0 0 1px #fdba74;
}
.legend .striped {
  border-radius: 2px;
  background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px);
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.spacer {
  flex: 1;
}
.hint {
  font-size: 11px;
}
.mini {
  padding: 2px 8px;
  font-size: 11px;
}
</style>
