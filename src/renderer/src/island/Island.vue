<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { breakdown, gapAround, infoAt } from '@shared/breakdown'
import { ISLAND_PANEL_WIDTH, ISLAND_PILL, ISLAND_WINDOW, DOCK_SIDE, DOCK_STRIP, type Dock } from '@shared/island'
import { clipEntries, dayEnd, dayStart, flattenForDisplay, formatDuration, formatHM, HOUR, joinTitle, laneIsFree, MINUTE, parseQuickDuration, quickRange, scheduleRanges, shiftDay, sortByStart, splitTitle, unionMs, uncutMs as uncutTime } from '@shared/timeline'
import type { Entry, EntryKind, LinkEnd, Ms, Note, PlanBlock, PublicSettings, Selection } from '@shared/types'
import Icon from '../components/Icon.vue'
import { todayKey } from '../lib/today'
import ThinkingOrb from '../components/ThinkingOrb.vue'
import DictateButton from '../components/DictateButton.vue'
import { VOICE_PENDING } from '@shared/voice'
import { DEFAULT_UI } from '@shared/ui'
import NoteEditor from '../components/NoteEditor.vue'
import ActivityWave from '../components/ActivityWave.vue'
import TaskPicker from '../components/TaskPicker.vue'
import { labelWithoutKey, plainTask, tasksWord, type TaskRef } from '@shared/jira'
import { COMBO_GAP_MS, type ComboState } from '@shared/combo'
import { saveRecording, startRecording, transcribeNote as transcribeAudio, type Recording } from '../lib/recorder'
import type { OrbState } from 'thinking-orbs/engine'
import { noteEntry, visibleNotes } from '@shared/notes'
import KindMenu from '../components/KindMenu.vue'
import LabelInput from '../components/LabelInput.vue'
import OffsetField from '../components/OffsetField.vue'
import SeriesAsk from '../components/SeriesAsk.vue'
import { askSeries } from '../lib/seriesAsk'
import TimeField from '../components/TimeField.vue'
import { APP_COLORS, entryIcon, kindColor, kindIcon, kindLabel, kinds, setKinds } from '../lib/palette'
import LinkLayer from '../components/LinkLayer.vue'
import LinkPicker from '../components/LinkPicker.vue'
import { linkedTo } from '@shared/links'
import { clusterize, useFan } from '../lib/pinfan'
import { productiveSplit, unlabelledMs, workDayMs } from '@shared/kinds'
import { recentLabels } from '../lib/recent'
import { useSelection } from '../lib/selection'
import { useDay } from '../lib/useDay'
import { pctOf, segBox, snap, ticks, useViewport, visible } from '../lib/viewport'

const today = todayKey
const { data, live, now, cursor } = useDay(today)
const sel = useSelection()
const openMain = (entryId?: string) => window.qa.openMain(undefined, entryId)

const settings = shallowRef<PublicSettings>()
async function loadSettings(): Promise<void> {
  const s = await window.qa.getSettings()
  settings.value = s
  setKinds(s.kinds)
}
// the pin state is read once — later reloads (on every expand) must not overwrite a click in flight
void loadSettings().then(() => {
  pinned.value = !!settings.value?.island.pinned
  if (pinned.value) setExpanded(true)
})

const yesterday = shallowRef<Entry[]>([])
void window.qa.getDay(shiftDay(today.value, -1)).then((d) => (yesterday.value = d.entries))
const recent = computed(() => recentLabels(data.value.entries, yesterday.value))

// ---------- layout / expand ----------

const up = ref(false)
/** Stuck to a screen edge: a slim pill flush with it (upright at a side edge); the panel opens from it. */
const dock = ref<Dock>()
/** At a side edge: the pill's centre from the window's top. */
const dockOffset = ref(ISLAND_WINDOW.height / 2)
function applyLayout(l: { up: boolean; dock?: Dock; offset?: number }): void {
  up.value = l.up
  dock.value = l.dock
  if (l.offset !== undefined) dockOffset.value = l.offset
}
void window.qa.getIslandLayout().then(applyLayout)
const offLayout = window.qa.onIslandLayout(applyLayout)
const sideDock = computed(() => dock.value === 'left' || dock.value === 'right')
/** The slim pill's length: the handle and the dot, plus what is switched on (Настройки → Интерфейс). */
const dockLen = computed(() => {
  const d = ui.value.dock
  return Math.max(150, 64 + (d.time ? 58 : 0) + (d.next && nextMeeting.value ? 84 : 0) + (d.orb ? 34 : 0) + (d.wave ? 76 : 0))
})
/** The next Outlook meeting today (the countdown on the slim pill). */
const nextMeeting = computed(() => data.value.entries.filter((e) => e.outlook && e.start > now.value).sort((a, b) => a.start - b.start)[0])
const nextIn = computed(() => {
  const m = nextMeeting.value
  if (!m) return ''
  const min = Math.max(1, Math.round((m.start - now.value) / 60_000))
  return min < 60 ? `${min}м` : `${Math.floor(min / 60)}ч ${String(min % 60).padStart(2, '0')}м`
})
/** A transcription is running / queued (the orb "thinks" meanwhile). */
const voiceBusy = ref(false)
void window.qa.voiceState().then((v) => (voiceBusy.value = v.busy.length > 0))
const offVoice = window.qa.onVoice((v) => (voiceBusy.value = v.busy.length > 0))
const offSettings = window.qa.onSettings((s) => {
  settings.value = s
  setKinds(s.kinds)
})
/** What the user chose to show (Настройки → Интерфейс). */
const ui = computed(() => settings.value?.ui ?? DEFAULT_UI)
/** The pill loses a row for each hidden line (chips / totals), never below the orb. */
const pillH = computed(() => Math.max(48, ISLAND_PILL.height - (ui.value.pill.chips ? 0 : 24) - (ui.value.pill.stats ? 0 : 17)))
/** Opacity of the collapsed pill's background (settings) — chips and text stay solid; opaque while hovered or expanded. */
const bgAlpha = computed(() => (expanded.value || hovering.value || noteOpen.value ? 1 : (settings.value?.island.opacity ?? 1)))

const expanded = ref(false)
const pinned = ref(false)
const hovering = ref(false)
const engaged = ref(false) // focus inside the panel / menu open — never collapse under the user's hands
const panel = ref<HTMLElement>()
const pillHandle = ref<HTMLElement>()
const panelH = ref(320)
let expandTimer: ReturnType<typeof setTimeout> | undefined
let collapseTimer: ReturnType<typeof setTimeout> | undefined

/** The collapsed pill is as wide as its content (measured after each render), within PILL_MIN..PILL_MAX. */
const PILL_MIN = 360
const PILL_MAX = 720
const pillW = ref(PILL_MIN)
const plineEl = ref<HTMLElement>()
const chipsEl = ref<HTMLElement>()
const statsEl = ref<HTMLElement>()
onMounted(measurePill)
function measurePill(): void {
  if (!plineEl.value) return
  // handle + gaps + right block + paddings/border around the two content lines
  // the first line spans the pill (date and time sit at its right edge) — its natural width is the sum of its parts
  const parts = ([...plineEl.value.children] as HTMLElement[]).filter((c) => !c.classList.contains('pwave') && !c.classList.contains('pfill'))
  const line = parts.reduce((a, c) => a + Math.max(c.offsetWidth, Math.min(c.scrollWidth, 150)), 0) + 6 * parts.length + 12 + (ui.value.pill.wave ? 70 : 0) // + room for the wave
  const content = Math.max(line, chipsEl.value?.scrollWidth ?? 0, statsEl.value?.scrollWidth ?? 0)
  const w = Math.min(PILL_MAX, Math.max(PILL_MIN, Math.ceil((content + 117) / 24) * 24)) // 24px steps: no jitter
  if (w !== pillW.value) pillW.value = w
}
/** Height of the quick-note area that opens next to the pill (below it, or above when the island grows up). */
const NOTE_H = 136
const size = computed(() =>
  expanded.value
    ? { w: ISLAND_PANEL_WIDTH, h: panelH.value }
    : dock.value && !noteOpen.value
      ? sideDock.value
        ? { w: DOCK_SIDE.w, h: dockLen.value }
        : { w: dockLen.value, h: DOCK_STRIP.h }
      : { w: Math.max(pillW.value, noteOpen.value ? 440 : 0), h: pillH.value + (noteOpen.value ? NOTE_H : 0) },
)
/** At a side edge the island stands on the pill's centre (inside the window). */
const shellTop = computed(() => (sideDock.value ? Math.max(0, Math.min(ISLAND_WINDOW.height - size.value.h, Math.round(dockOffset.value - size.value.h / 2))) : 0))
// main docks the island by its real rectangle in the window
let rectTimer: ReturnType<typeof setTimeout> | undefined
function reportRect(): void {
  clearTimeout(rectTimer)
  rectTimer = setTimeout(() => {
    const r = shell.value?.getBoundingClientRect()
    if (r && r.width) window.qa.islandRect({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
  }, 480)
}
// (watched once mounted: size reads state declared further down)
onMounted(() => {
  watch([size, dock, shellTop], reportRect)
  reportRect()
})


function setExpanded(v: boolean): void {
  if (v === expanded.value) return
  expanded.value = v
  if (v) void loadSettings()
  else {
    entryId.value = undefined
    menu.value = undefined
    window.qa.islandBlur()
  }
}

function inside(el: HTMLElement | undefined, x: number, y: number, margin = 0): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin
}
/**
 * The move handle is a native drag region: the page gets no mouse events over it. So the last point seen
 * before it (right next to it) means "on the handle" — such a hover never expands the pill.
 */
const HANDLE_ZONE = 14
let last = { x: -1, y: -1 }
const nearHandle = (x: number, y: number) => inside(pillHandle.value, x, y, HANDLE_ZONE)
/** The orb is a button: hovering it — or the strip above, right of and below it — must not expand the pill. */
const orbEl = ref<HTMLElement>()
const ORB_ZONE = 16
const nearOrb = (x: number, y: number) => inside(orbEl.value, x, y, ORB_ZONE)
const noExpandAt = (x: number, y: number) => noteOpen.value || nearHandle(x, y) || nearOrb(x, y)

/** Hover comes from main (with the cursor point): the move handle never triggers the expansion. */
let suppressUntilLeave = false
/**
 * Hover and click-through are decided here, from the island's own mouse events (forwarded by Electron
 * while the window is click-through). Window-relative coordinates never drift when the window is moved
 * between monitors with different scaling — the previous geometry check in main did.
 */
const shell = ref<HTMLElement>()
/** A dropdown opened as a layer outside the shell (teleported to <body>): the pointer over it is "on the island". */
function overLayer(x: number, y: number): boolean {
  for (const el of document.body.children) {
    if (el.id === 'app' || !(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  return false
}
let solidNow = false
const SOLID_MARGIN = 16
function onDocMouse(e: MouseEvent): void {
  const r = shell.value?.getBoundingClientRect()
  if (!r) return
  const within = (m: number) => e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m
  // the window turns "solid" a little before the cursor reaches the content, so a quick click on a
  // button never races the click-through switch; the 16px ring is the only area that stops being see-through
  const layer = overLayer(e.clientX, e.clientY)
  const solid = within(SOLID_MARGIN) || layer
  if (solid !== solidNow) {
    solidNow = solid
    window.qa.islandSolid(solid)
  }
  last = { x: e.clientX, y: e.clientY }
  // leaving needs the cursor clearly outside — resting on the very edge must not collapse the island
  onHover(within(hovering.value ? 14 : 0) || layer, e.clientX, e.clientY)
}
function onDocLeave(e: MouseEvent): void {
  // switching the window between click-through and normal makes Chromium report a spurious "leave"
  // while the cursor is still on the content — only a real leave (outside the content) counts
  const r = shell.value?.getBoundingClientRect()
  const m = SOLID_MARGIN
  if ((r && e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m) || overLayer(e.clientX, e.clientY)) {
    // entering the drag region of the handle also looks like a "leave": stay compact
    if (!expanded.value && nearHandle(e.clientX, e.clientY)) {
      clearTimeout(expandTimer)
      expandTimer = undefined
    }
    return
  }
  if (solidNow) {
    solidNow = false
    window.qa.islandSolid(false)
  }
  onHover(false, -1, -1)
}
document.addEventListener('mousemove', onDocMouse)
document.addEventListener('mouseleave', onDocLeave)

const offHover = window.qa.onIslandHover((h) => {
  if (h.moved) {
    // a native drag has just ended: the window was solid all along; dragged the pill — stay compact
    solidNow = true
    clearTimeout(expandTimer)
    expandTimer = undefined
    if (!expanded.value) suppressUntilLeave = true
  }
  if (h.leave) {
    solidNow = false
    onHover(false, -1, -1)
  }
})

function onHover(isInside: boolean, x: number, y: number): void {
  hovering.value = isInside
  if (isInside) {
    clearTimeout(collapseTimer)
    collapseTimer = undefined
    if (expanded.value) return
    if (suppressUntilLeave || noExpandAt(x, y)) {
      clearTimeout(expandTimer)
      expandTimer = undefined
    } else if (!expandTimer) {
      expandTimer = setTimeout(() => {
        expandTimer = undefined
        // the cursor may have slid onto the handle meanwhile (no events there) — the last point tells
        if (hovering.value && !noExpandAt(last.x, last.y)) setExpanded(true)
      }, 280)
    }
    return
  }
  clearTimeout(expandTimer)
  expandTimer = undefined
  suppressUntilLeave = false
  if (!collapseTimer)
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      if (!engaged.value && !pinned.value && !hovering.value && !menu.value) setExpanded(false)
    }, 450)
}

const labelInput = ref<InstanceType<typeof LabelInput>>()
const offHotkey = window.qa.onIslandHotkey(async () => {
  setExpanded(true)
  await nextTick()
  labelInput.value?.focus()
})

const isTextField = (el: Element | null | EventTarget) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

function onFocusIn(e: FocusEvent): void {
  engaged.value = isTextField(e.target)
}
function onFocusOut(): void {
  setTimeout(() => {
    engaged.value = !!panel.value?.contains(document.activeElement) && isTextField(document.activeElement)
    if (!engaged.value && !hovering.value && !pinned.value && !menu.value) setExpanded(false)
  }, 0)
}
window.addEventListener('blur', () => {
  engaged.value = false
  if (!hovering.value && !pinned.value) setExpanded(false)
})

let ro: ResizeObserver | undefined
watch(panel, (el) => {
  ro?.disconnect()
  if (!el) return
  ro = new ResizeObserver(() => (panelH.value = Math.min(Math.ceil(el.scrollHeight), ISLAND_WINDOW.height)))
  ro.observe(el)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDocMouse)
  document.removeEventListener('mouseleave', onDocLeave)
  offLayout()
  offHover()
  offHotkey()
  offCombo()
  offSettings()
  offVoice()
  ro?.disconnect()
})

async function togglePin(): Promise<void> {
  pinned.value = !pinned.value
  if (!pinned.value) {
    ;(document.activeElement as HTMLElement | null)?.blur()
    engaged.value = false
    if (!hovering.value) setExpanded(false)
  }
  await window.qa.updateSettings({ island: { pinned: pinned.value } })
}

// ---------- moving the island ----------
// Native window drag: the handle (and the title in the header) are -webkit-app-region: drag. Such areas
// get no DOM events, so a click elsewhere on the pill expands it and a click on the header resets the selection.

function onHeadClick(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest('button, input, .nodrag')) resetSelection()
}

// ---------- visible window ----------

const schedule = computed(() => (settings.value ? scheduleRanges(today.value, settings.value.schedule) : {}))
const initial = computed<[Ms, Ms]>(() => {
  const starts = data.value.spans.map((s) => s.start)
  const ends = [now.value + 10 * MINUTE]
  if (schedule.value.work) {
    starts.push(schedule.value.work[0])
    ends.push(schedule.value.work[1])
  }
  const a = starts.length ? Math.min(...starts) : now.value - 4 * HOUR
  return [Math.floor(a / HOUR) * HOUR, Math.ceil(Math.max(...ends) / HOUR) * HOUR]
})
const vp = useViewport({ bounds: () => [dayStart(today.value), dayEnd(today.value)], initial: () => initial.value, minSpan: 15 * MINUTE })
const from = vp.from
const to = vp.to
const box = (a: Ms, b: Ms, gap = 1) => segBox(a, b, from.value, to.value, gap)
const pct = (t: Ms) => pctOf(t, from.value, to.value)
/** Kinds offered as buttons (hidden ones stay in settings and on old blocks). */
const shownKinds = computed(() => kinds.value.filter((k) => !k.hidden))
/** Track width in px (panel minus paddings) — decides whether icons/labels fit into a block. */
const TRACK_W = ISLAND_PANEL_WIDTH - 32
/** Width in px of [a, b] on a track of `trackPx` pixels — decides whether an icon fits. */
const px = (a: Ms, b: Ms, trackPx: number) => ((Math.min(b, to.value) - Math.max(a, from.value)) / (to.value - from.value)) * trackPx

/** Entries with an in-progress drag (move / edge / lane change) applied. */
const resized = ref<{ id: string; start: Ms; end: Ms; lane?: number }>()
const entries = computed(() => {
  const r = resized.value
  return r ? data.value.entries.map((e) => (e.id === r.id ? { ...e, start: r.start, end: r.end, lane: r.lane ?? e.lane } : e)) : data.value.entries
})
/** All segments (not clipped to the view) — lanes are a property of the whole day. */
const allSegs = computed(() => flattenForDisplay(entries.value, resized.value?.id))
const segs = computed(() => visible(allSegs.value, from.value, to.value))
/** Lane each main-line entry is displayed on. */
const laneOf = (id: string) => allSegs.value.find((x) => x.entry.id === id)?.lane ?? 0
const activity = computed(() => visible(data.value.activity, from.value, to.value))
const off = computed(() => {
  const out: Array<{ start: Ms; end: Ms }> = []
  let prev = from.value
  for (const s of sortByStart(data.value.spans)) {
    if (s.start > prev) out.push({ start: prev, end: s.start })
    prev = Math.max(prev, s.end)
  }
  if (prev < now.value - 2 * MINUTE) out.push({ start: prev, end: now.value })
  return visible(out, from.value, to.value)
})
/** Not labelled since the last block — only while QA was on (the bar itself starts right at the block). */
const uncutMs = computed(() => uncutTime(cursor.value, now.value))

/** Axis labels: ticks + official start/lunch/end markers + "Сейчас"; the more important label wins on overlap. */
const axis = computed(() => {
  const nowPct = Math.min(pctOf(now.value, from.value, to.value), 88)
  const marks: Array<{ t: Ms; text: string; cls: string }> = []
  const w = schedule.value.work
  const l = schedule.value.lunch
  if (w) marks.push({ t: w[0], text: `Начало ${formatHM(w[0])}`, cls: 'sch' }, { t: w[1], text: `Конец ${formatHM(w[1])}`, cls: 'sch' })
  if (l) marks.push({ t: l[0], text: 'Обед', cls: 'lunch' })
  const inView = marks.filter((m) => m.t >= from.value && m.t <= to.value && Math.abs(pctOf(m.t, from.value, to.value) - nowPct) > 12)
  const taken = [nowPct, ...inView.map((m) => pctOf(m.t, from.value, to.value))]
  const tk = ticks(from.value, to.value, 18)
  // the wide "Сейчас HH:MM" label needs more room than the others
  const list = tk.list.filter((t) => {
    const p = pctOf(t, from.value, to.value)
    return Math.abs(p - nowPct) > 9 && taken.slice(1).every((q) => Math.abs(p - q) > 5.5)
  })
  // unlabeled divisions between labels: quarters for hour+ steps, halves otherwise
  const sub = tk.step >= HOUR ? tk.step / 4 : tk.step / 2
  const minor: Ms[] = []
  for (let t = Math.ceil(from.value / sub) * sub; t <= to.value; t += sub) if (!tk.list.includes(t)) minor.push(t)
  return { list, marks: inView, minor, all: tk.list }
})

const status = computed(() =>
  live.value.inCall
    ? { text: 'Созвон', cls: 'call' }
    : live.value.idle
      ? { text: 'Простой', cls: 'idle' }
      : { text: 'Работаю', cls: 'work' },
)

// ---------- the collapsed pill: all blocks as equal chips, independent of the expanded timeline's zoom ----------

/** Official work time of today without lunch; 0 on a day off. */
const workMs = computed(() => {
  const s = settings.value?.schedule
  return s ? workDayMs(today.value, s, new Date(dayStart(today.value)).getDay()) : 0
})
const dayOff = computed(() => !!settings.value && workMs.value === 0)
/** Productive time inside working hours (the base of "% of the work day") and over time (outside / day off). */
const split = computed(() => productiveSplit(clipEntries(data.value.entries, now.value), kinds.value, schedule.value.work, schedule.value.lunch))
const productive = computed(() => split.value.total)
/** 100% = the whole official work day filled with productive blocks; over time is shown separately. */
const productivePct = computed(() => (workMs.value ? Math.min(100, Math.round((split.value.within / workMs.value) * 100)) : 0))
/** A chip shows its share of the work day; on a day off (no base) — its duration. */
const chipText = (ms: number) => (workMs.value ? `${Math.max(1, Math.round((ms / workMs.value) * 100))}%` : ms < MINUTE ? '<1м' : formatDuration(ms))
/** QA-on time not covered by any block, and time in apps (active input), — both absolute. */
const unlabelled = computed(() =>
  unlabelledMs(
    clipEntries(data.value.entries, now.value),
    data.value.spans.map((x) => ({ start: x.start, end: Math.min(x.end, now.value) })),
  ),
)
const appsMs = computed(() =>
  data.value.activity.filter((x) => x.kind !== 'idle' && x.kind !== 'locked').reduce((a, x) => a + (x.end - x.start), 0),
)

const CHIP_GAP = 4
const CHIP_AREA = PILL_MAX - 117 // handle, gaps, orb, paddings
/** Estimated chip width for its text (chips size to their content: "12%" or "1ч 05м"). */
const textW = (t: string) => t.length * 6.4
const chipW = (ms: number) => 30 + textW(chipText(ms))
const NOTE_CHIP_W = 22
type PillItem =
  | { type: 'entry'; t: Ms; e: Entry }
  | { type: 'note'; t: Ms; n: Note }
  | { type: 'uncut'; t: Ms; ms: Ms; live: boolean }
  | { type: 'plan'; t: Ms; p: PlanBlock }
/**
 * Blocks, notes and the live uncut tail in time order. Only the latest that fit are shown — the pill
 * never grows past its cap however busy the day is.
 */
const pillItems = computed(() => {
  const items: PillItem[] = [
    ...data.value.entries.map((e) => ({ type: 'entry' as const, t: e.start, e })),
    ...visibleNotes(data.value.notes).map((n) => ({ type: 'note' as const, t: n.at, n })),
    // what is still planned for today (dashed), if switched on in the settings
    ...(ui.value.pill.plan ? (data.value.plan ?? []).filter((p) => p.end > now.value).map((p) => ({ type: 'plan' as const, t: Math.max(p.start, now.value), p })) : []),
  ]
  // the uncut tail is cut by the notes made during it: uncut · note · uncut … (only the last part is "live")
  if (uncutMs.value >= MINUTE) {
    const cuts = visibleNotes(data.value.notes).map((n) => n.at).filter((t) => t > cursor.value && t < now.value)
    const bounds = [cursor.value, ...cuts, now.value]
    for (let i = 0; i < bounds.length - 1; i++) {
      const ms = uncutTime(bounds[i], bounds[i + 1])
      const live = i === bounds.length - 2
      if (ms >= MINUTE || live) items.push({ type: 'uncut', t: bounds[i], ms, live })
    }
  }
  items.sort((a, b) => a.t - b.t || (a.type === 'uncut' ? -1 : 1))
  const width = (it: PillItem) =>
    it.type === 'entry'
      ? chipW(it.e.end - it.e.start) + (it.e.task ? textW(it.e.task.key) + 4 : 0)
      : it.type === 'note'
        ? NOTE_CHIP_W
        : it.type === 'plan'
          ? chipW(it.p.end - it.p.start)
          : chipW(it.ms) + 8
  const shown: PillItem[] = []
  let used = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const w = width(items[i]) + CHIP_GAP
    if (used + w > CHIP_AREA) break
    shown.unshift(items[i])
    used += w
  }
  return shown
})

/** Time per kind of block so far today (planned parts not counted), longest first. */
const kindTotals = computed(() => {
  const m = new Map<string, number>()
  for (const e of clipEntries(data.value.entries, now.value)) m.set(e.kind, (m.get(e.kind) ?? 0) + (e.end - e.start))
  return [...m].sort((a, b) => b[1] - a[1])
})
/** Time per linked Jira task so far today, longest first (appears as soon as a block is linked). */
const taskTotals = computed(() => {
  const m = new Map<string, { ms: number; summary: string }>()
  for (const e of clipEntries(data.value.entries, now.value)) {
    if (!e.task) continue
    const x = m.get(e.task.key) ?? { ms: 0, summary: e.task.summary }
    x.ms += e.end - e.start
    m.set(e.task.key, x)
  }
  return [...m].sort((a, b) => b[1].ms - a[1].ms)
})
const pctTitle = computed(() =>
  workMs.value
    ? `Полезное время в рабочие часы: ${formatDuration(split.value.within)} из ${formatDuration(workMs.value)} рабочего дня (без перерывов и обеда)`
    : 'Выходной — рабочего дня нет',
)

/** One-line summary for the collapsed pill. */
const pillInfo = computed(() => {
  const l = live.value
  if (l.inCall) {
    const call = [...data.value.calls].reverse().find((c) => now.value - c.end < 2 * MINUTE)
    return `${l.callApp ?? 'Созвон'}${call ? ` · ${formatDuration(now.value - call.start)}` : ''}`
  }
  if (l.idle) return '' // "Простой" next to it says it all
  return l.app ?? '—'
})

/** "10 сб, окт 2026" */
const dateText = computed(() => {
  const d = new Date(dayStart(today.value))
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()]
  const mon = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()]
  return `${d.getDate()} ${wd}, ${mon} ${d.getFullYear()}`
})

// ---------- the frog mascot ----------

/** How long the current app has been in the foreground without a switch (idle breaks the run). */
const sameAppMs = computed(() => {
  const app = live.value.app
  if (!app || live.value.idle) return 0
  let start = now.value
  for (let i = data.value.activity.length - 1; i >= 0; i--) {
    const a = data.value.activity[i]
    if (a.app !== app || a.kind === 'idle' || a.kind === 'locked' || start - a.end > 2 * MINUTE) break
    start = a.start
  }
  return now.value - start
})
/**
 * The orb mirrors what is going on (each state is a distinct animation of thinking-orbs, tinted):
 * idle → slow breathing ring, call → listening wave, long in one app → solving / shaping (time to
 * switch), lots unlabelled → searching globe, day filled → connecting web, after hours → slow weave,
 * typing a note → composing sash, otherwise → working orbits.
 */
const mascot = computed<{ state: OrbState; tint: string; speed: number; title: string }>(() => {
  const l = live.value
  const w = schedule.value.work
  const tip = (t: string) => `${t}\nКлик — быстрая заметка`
  if (recording.value) return { state: 'listening', tint: '#f87171', speed: 1.4, title: 'Идёт запись — клик: открыть' }
  if (voiceBusy.value) return { state: 'solving', tint: '#c4b5fd', speed: 1.8, title: 'Расшифровываю голос…' }
  if (noteOpen.value) return { state: 'composing', tint: '#fde68a', speed: 1, title: 'Пишу заметку — клик по сфере, чтобы закончить' }
  if (l.idle) return { state: 'breathing', tint: '#94a3b8', speed: 0.5, title: tip('Нет ввода — сфера дремлет') }
  if (l.inCall) return { state: 'listening', tint: '#5eead4', speed: 1, title: tip('Созвон — сфера слушает') }
  if (sameAppMs.value >= 30 * MINUTE)
    return { state: 'shaping', tint: '#fcd34d', speed: 0.8, title: tip(`${formatDuration(sameAppMs.value)} в ${l.app} без перерыва — пора размяться`) }
  if (uncutMs.value >= 2 * HOUR) return { state: 'searching', tint: '#fdba74', speed: 1, title: tip(`${formatDuration(uncutMs.value)} не размечено — что это было?`) }
  if (sameAppMs.value >= 20 * MINUTE) return { state: 'solving', tint: '#a5b4fc', speed: 1, title: tip(`Фокус: ${formatDuration(sameAppMs.value)} в ${l.app}`) }
  if (workMs.value && split.value.within >= workMs.value) return { state: 'connecting', tint: '#f9a8d4', speed: 1, title: tip('Рабочий день заполнен!') }
  if (dayOff.value || (w && now.value >= w[1])) return { state: 'weaving', tint: '#7dd3fc', speed: 0.6, title: tip('Нерабочее время') }
  return { state: 'working', tint: '#86efac', speed: 1, title: tip('Работаем') }
})

// ---------- typing combo ----------
// Only counts arrive here (never which keys). While typing: the live streak shakes, grows and reddens
// with the combo; after a 3 s pause it is over and the day's best is shown.

const combo = ref<ComboState>({ current: 0, last: 0, best: 0 })
const typing = ref(false)
let comboTimer: ReturnType<typeof setTimeout> | undefined
void window.qa.getCombo().then((c) => (combo.value = c))
const offCombo = window.qa.onCombo((c) => {
  combo.value = c
  typing.value = c.current > 1
  clearTimeout(comboTimer)
  comboTimer = setTimeout(() => (typing.value = false), COMBO_GAP_MS)
})
/** 0 → 1 as the streak grows to 150 presses: drives size, shake and colour. */
const heat = computed(() => Math.min(1, combo.value.current / 150))
const comboOn = computed(() => settings.value?.countKeys !== false && (typing.value || combo.value.best > 0))

// ---------- quick note (click the orb) ----------
// A click opens a textarea next to the pill; the text is saved while typing. The next click closes it —
// the note becomes a pin on the timeline and belongs to the block running at its moment (e.g. a call).

const noteOpen = ref(false)
const note = ref<{ id: string; at: Ms; text: string }>()
const noteArea = ref<HTMLTextAreaElement>()
let noteTimer: ReturnType<typeof setTimeout> | undefined
/** The block the open note will belong to (or "during a call" when the call block is not cut yet). */
const noteTarget = computed(() => {
  const n = note.value
  if (!n) return undefined
  const e = noteEntry(n, data.value.entries)
  if (e) return `${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` · ${e.label}` : ''}`
  return live.value.inCall ? 'созвон' : undefined
})

async function toggleNote(): Promise<void> {
  if (noteOpen.value) return closeNote()
  clearTimeout(expandTimer)
  expandTimer = undefined
  note.value = { id: crypto.randomUUID(), at: Date.now(), text: '' }
  nLinks.value = []
  noteHasAudio.value = false
  qMsg.value = ''
  // during a call the panel opens on the call tab; a running recording — on its tab
  if (recording.value) qtab.value = recording.value.kind === 'call' ? 'call' : 'audio'
  noteOpen.value = true
  window.qa.islandFocus()
  await nextTick()
  // the shell is still growing: a plain focus() would scroll the (overflow: hidden) shell to the textarea
  // and the whole pill would slide up and back — focus without scrolling, and keep the shell unscrolled
  noteArea.value?.focus({ preventScroll: true })
  if (shell.value) shell.value.scrollTop = 0
}
function onNoteInput(): void {
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => void saveNote(), 400)
}
async function saveNote(): Promise<void> {
  const n = note.value
  if (n?.text.trim()) {
    await window.qa.saveNote(today.value, { ...n })
    await applyNoteLinks(n.id)
  }
}
/** What the quick note is linked with (blocks / notes of today); stored once the note itself exists. */
const nLinks = ref<LinkEnd[]>([])
let nLinksSaved = '[]'
async function applyNoteLinks(id: string): Promise<void> {
  const key = JSON.stringify(nLinks.value)
  if (key === nLinksSaved) return
  nLinksSaved = key
  await window.qa.setLinks(today.value, { type: 'note', id }, nLinks.value.map((l) => ({ type: l.type, id: l.id })))
}
watch(nLinks, async () => {
  const n = note.value
  if (!n) return
  if (n.text.trim()) {
    clearTimeout(noteTimer)
    await window.qa.saveNote(today.value, { ...n })
    await applyNoteLinks(n.id)
  } else if (noteHasAudio.value) await applyNoteLinks(n.id)
})
async function closeNote(): Promise<void> {
  clearTimeout(noteTimer)
  const n = note.value
  noteOpen.value = false
  note.value = undefined
  qMsg.value = ''
  window.qa.islandBlur()
  if (!n) return
  if (noteHasAudio.value) return void (await applyNoteLinks(n.id))
  if (n.text.trim()) {
    await window.qa.saveNote(today.value, { ...n })
    await applyNoteLinks(n.id)
  } else await window.qa.deleteNote(today.value, n.id) // typed and erased — nothing to keep
  nLinks.value = []
  nLinksSaved = '[]'
}

// ---------- the orb panel: Текст / Аудио / Событие / Звонок ----------

type QTab = 'text' | 'audio' | 'event' | 'call'
const qtab = ref<QTab>(readQTab())
function readQTab(): QTab {
  try {
    const v = localStorage.getItem('qa.orbTab')
    return v === 'audio' || v === 'event' || v === 'call' ? v : 'text'
  } catch {
    return 'text'
  }
}
watch(qtab, (v) => {
  try {
    localStorage.setItem('qa.orbTab', v)
  } catch {
    // not remembered
  }
})
const qMsg = ref('')
/** The open note already got its audio (it must not be deleted as "empty" on close). */
const noteHasAudio = ref(false)

/** A recording in progress (a voice note or the call) — it goes on even with the panel closed. */
const recording = shallowRef<{ kind: 'voice' | 'call'; rec: Recording; at: Ms; id: string }>()
const recLevel = ref(0)
const recSec = ref(0)
let recTimer: ReturnType<typeof setInterval> | undefined
async function startRec(kind: 'voice' | 'call'): Promise<void> {
  if (recording.value) return
  qMsg.value = ''
  try {
    const rec = await startRecording(kind)
    recording.value = { kind, rec, at: Date.now(), id: kind === 'voice' && note.value ? note.value.id : crypto.randomUUID() }
    recSec.value = 0
    recTimer = setInterval(() => {
      recLevel.value = recording.value?.rec.level() ?? 0
      recSec.value = recording.value ? (Date.now() - recording.value.at) / 1000 : 0
    }, 120)
  } catch (e) {
    qMsg.value = e instanceof Error ? e.message : String(e)
  }
}
async function stopRec(): Promise<void> {
  const r = recording.value
  if (!r) return
  recording.value = undefined
  clearInterval(recTimer)
  const { blob, durationSec } = await r.rec.stop()
  if (durationSec < 1) {
    qMsg.value = 'Слишком короткая запись'
    return
  }
  const text = r.kind === 'voice' ? (note.value?.text ?? '') : ''
  const saved = await window.qa.saveAudioNote(today.value, { id: r.id, at: r.at, durationSec, kind: r.kind, text }, new Uint8Array(await blob.arrayBuffer()))
  if (r.kind === 'voice' && note.value?.id === r.id) noteHasAudio.value = true
  qMsg.value = r.kind === 'call' ? 'Запись звонка сохранена' : 'Голосовая заметка сохранена'
  if (settings.value?.voice.enabled && settings.value?.voice.autoTranscribe && saved.audio) {
    const vs = await window.qa.voiceState()
    if (vs.modelReady) {
      qMsg.value += ' · расшифровка…'
      transcribeAudio(today.value, saved.id, saved.audio.file)
        .then(() => (qMsg.value = qMsg.value.replace(' · расшифровка…', ' · расшифровано')))
        .catch((e: Error) => (qMsg.value = e.message))
    }
  }
}
const fmtRec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** Событие: a block in a couple of clicks — kind, period, an optional title. */
const qKind = ref('task')
const qLabel = ref('')
/** What the quick event is linked with; while the list is open the mini island grows to show it. */
const qLinks = ref<LinkEnd[]>([])
const qLinksOpen = ref(false)
// the list unmounts with the note / tab — the extra room goes with it
watch([() => noteOpen.value, () => qtab.value], () => (qLinksOpen.value = false))
/** ± minutes from now: − the last N, + the next N. */
const qOff = ref(-30)
async function addQuickEvent(dict?: Dictation): Promise<void> {
  const t = Math.floor(Date.now() / MINUTE) * MINUTE
  const start = qOff.value < 0 ? t + qOff.value * MINUTE : t
  const end = qOff.value < 0 ? t : t + qOff.value * MINUTE
  // first line — the title, the rest — the description
  const parts = splitTitle(qLabel.value)
  const label = parts.label || (dict ? VOICE_PENDING : kindLabel(qKind.value))
  const saved = await window.qa.saveEntry(today.value, { start, end, kind: qKind.value, label, description: parts.description, source: 'manual' }, { overlap: true })
  if (qLinks.value.length) await window.qa.setLinks(today.value, { type: 'entry', id: saved.id }, qLinks.value.map((l) => ({ type: l.type, id: l.id })))
  qLinks.value = []
  if (dict) void saveRecording(today.value, { ...dict, at: start }, { entryId: saved.id })
  qMsg.value = `Добавлено · ${kindLabel(qKind.value)} ${formatHM(start)}–${formatHM(end)}${dict ? ' · расшифровка…' : ''}`
  qLabel.value = ''
}
/** Текст: the note becomes an own task (the note stays, linked). */
async function quickToTask(): Promise<void> {
  const n = note.value
  if (!n?.text.trim()) return
  clearTimeout(noteTimer)
  await window.qa.saveNote(today.value, { ...n })
  await applyNoteLinks(n.id)
  await window.qa.noteToTask(today.value, n.id)
  // the note is now a "Задача" block on the timeline — the panel closes (nothing left to save or delete)
  noteOpen.value = false
  note.value = undefined
  nLinks.value = []
  nLinksSaved = '[]'
  window.qa.islandBlur()
}
function onNoteKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') void closeNote()
}

/** The note open in the expanded island (a new one, or a pin clicked on the timeline). */
const panelNote = ref<{ id: string; at: Ms; text: string; taskId?: string; isNew?: boolean }>()
function openPanelNote(n?: Note): void {
  // a second click (on the same pin, or on the header button) closes it — the editor saves on its way out
  if (panelNote.value && (!n || panelNote.value.id === n.id)) {
    panelNote.value = undefined
    return
  }
  // a new note starts at "now"; clicking the timeline while it is open moves it to that moment
  panelNote.value = n ? { id: n.id, at: n.at, text: n.text, taskId: n.taskId } : { id: crypto.randomUUID(), at: Date.now(), text: '', isNew: true }
}

/** A text note — the note icon; a voice note — a mic; a call recording — a phone. */
const noteIcon = (n: Note) => (n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note')

/** Note pins on the expanded timeline. */
const notePins = computed(() => visibleNotes(data.value.notes).filter((n) => n.at >= from.value && n.at <= to.value))
/** Notes at (almost) the same moment spread apart on hover. */
const fan = useFan()
const pinPlaces = computed(() => clusterize(notePins.value, (n) => (pct(n.at) / 100) * TRACK_W, 13))
const fanZone = computed(() => {
  const k = fan.open.value
  const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
  const p = k && notePins.value.find((x) => x.id === k)
  return p && n > 1 ? { pct: pct(p.at), width: (n - 1) * 16 + 22 } : undefined
})
function noteTitle(n: Note): string {
  const e = noteEntry(n, data.value.entries)
  return `Заметка ${formatHM(n.at)}${e ? ` · ${kindLabel(e.kind)}${e.label && e.label !== kindLabel(e.kind) ? ` «${e.label}»` : ''}` : ''}\n${n.text}`
}

// ---------- marker ----------

const marker = computed<Selection | null>(() => (sel.selection.value?.day === today.value ? sel.selection.value : null))

// the pill content lives in a <Transition> slot (re-rendered by the transition, not by this component):
// re-measure after anything that changes its width
watch(
  () => [pillItems.value, pillInfo.value, status.value.text, marker.value, Math.floor(uncutMs.value / MINUTE), expanded.value, typing.value, ui.value],
  measurePill,
  { flush: 'post' },
)
/** Without a marker the cut targets the uncut tail (type + Enter). It is not drawn as a band. */
/** Without a picked range a quick add goes to the latest free work time, else an hour forward (see quickRange). */
const implicit = computed<Selection | null>(() => {
  const r = quickRange(data.value.entries, schedule.value.work, schedule.value.lunch, now.value, cursor.value)
  return { day: today.value, start: r.start, end: r.end >= now.value - MINUTE ? undefined : r.end }
})
const active = computed(() => marker.value ?? implicit.value)
const activeEnd = computed(() => (active.value ? (active.value.end ?? now.value) : 0))

function makeSel(start: Ms, end: Ms): Selection {
  // only an end right at "now" follows the time; a future end is a fixed, planned end
  return { day: today.value, start, end: Math.abs(now.value - end) < MINUTE ? undefined : end }
}

function resetSelection(): void {
  entryId.value = undefined
  pinT.value = undefined
  multi.value = new Set()
  sel.clear()
}

/** ±minutes (the last 10 by default): − the last N minutes up to now, + the next N from now; it moves the marker live. */
const DIAL_DEFAULT = -10
const dial = ref(DIAL_DEFAULT)
function onDial(v: number): void {
  dial.value = v
  if (v < 0) lastMinutes(-v)
  else if (v > 0) nextMinutes(v)
}
function nextMinutes(n: number): void {
  entryId.value = undefined
  pinT.value = undefined
  const t = Math.floor(now.value / MINUTE) * MINUTE
  sel.commit({ day: today.value, start: t, end: t + n * MINUTE })
}
watch(marker, (m) => {
  if (!m) dial.value = DIAL_DEFAULT
})

function lastMinutes(n: number): void {
  entryId.value = undefined
  pinT.value = undefined
  sel.commit({ day: today.value, start: now.value - n * MINUTE })
}

// ---------- track pointer ----------
// click            → a time divider at that moment; on a block the block is highlighted (details below)
// press + drag     → select a range (from empty space; Shift — from anywhere)
// drag a block     → move it; overlaps with other blocks go parallel
// Ctrl+click block → multi-select (right-click → merge / kind / delete)
// with a selection: click on another block → copy its kind/text ("continue that topic"); elsewhere → drop it

const track = ref<HTMLElement>()
type TrackDrag =
  | { type: 'create'; x0: number; t0: Ms; t1: Ms; moved: boolean; hitId?: string; ctrl: boolean }
  | { type: 'edge'; edge: 'start' | 'end' }
  | { type: 'resize'; id: string; edge: 'start' | 'end'; start: Ms; end: Ms; x0: number; moved: boolean }
  | { type: 'move'; id: string; x0: number; y0: number; t0: Ms; offset: Ms; dur: Ms; start: Ms; lane: number; moved: boolean }
  | { type: 'pin'; x0: number; t0: Ms; moved: boolean }
  | { type: 'pan'; x0: number; from0: Ms; span: number }
const tdrag = ref<TrackDrag>()
const hoverT = ref<Ms>()
/** The time divider placed by a click. */
const pinT = ref<Ms>()
// an open note takes the moment clicked on the timeline
watch(pinT, (t) => {
  // only a note being written right now — an existing one (or a recording) keeps its moment
  if (t !== undefined && panelNote.value?.isNew) panelNote.value = { ...panelNote.value, at: t }
})
/** Ctrl+click multi-selection. */
const multi = ref<Set<string>>(new Set())

const snapPoints = computed(() => {
  const moving = tdrag.value?.type === 'move' ? tdrag.value.id : undefined
  const pts: Ms[] = [now.value]
  for (const e of data.value.entries) if (e.id !== moving) pts.push(e.start, e.end)
  for (const s of data.value.spans) pts.push(s.start, s.end)
  for (const c of data.value.calls) pts.push(c.start, c.end)
  const w = schedule.value
  if (w.work) pts.push(...w.work)
  if (w.lunch) pts.push(...w.lunch)
  return pts
})

function rawTime(clientX: number): Ms {
  const r = track.value!.getBoundingClientRect()
  return from.value + ((clientX - r.left) / r.width) * (to.value - from.value)
}

function timeAt(clientX: number, snapIt = true): Ms {
  const r = track.value!.getBoundingClientRect()
  const t = rawTime(clientX)
  const v = snapIt ? snap(t, snapPoints.value, (to.value - from.value) / r.width) : t
  // planned blocks are allowed: anything up to the end of the day
  return Math.max(from.value, Math.min(v, dayEnd(today.value)))
}

/** Pointer capture retargets events to the track — hit-test by coordinates. */
function entryAt(x: number, y: number): Entry | undefined {
  const id = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-entry]')?.dataset.entry
  return id ? data.value.entries.find((e) => e.id === id) : undefined
}

function onTrackDown(e: PointerEvent): void {
  if (e.button === 1) {
    // middle button held: scroll the timeline horizontally
    e.preventDefault()
    tdrag.value = { type: 'pan', x0: e.clientX, from0: from.value, span: to.value - from.value }
    track.value!.setPointerCapture(e.pointerId)
    return
  }
  if (e.button !== 0) return
  const t = timeAt(e.clientX)
  const hit = entryAt(e.clientX, e.clientY)
  // an Outlook meeting does not move (Outlook's)
  if (hit && !hit.outlook && !e.shiftKey && !e.ctrlKey)
    tdrag.value = {
      type: 'move',
      id: hit.id,
      x0: e.clientX,
      y0: e.clientY,
      t0: rawTime(e.clientX),
      offset: rawTime(e.clientX) - hit.start,
      dur: hit.end - hit.start,
      start: hit.start,
      lane: laneOf(hit.id),
      moved: false,
    }
  else tdrag.value = { type: 'create', x0: e.clientX, t0: t, t1: t, moved: false, hitId: hit?.id, ctrl: e.ctrlKey }
  track.value!.setPointerCapture(e.pointerId)
}

/** The time chip of the divider: drag left/right to select from that moment (works over blocks too). */
function onPinDown(e: PointerEvent): void {
  if (e.button !== 0 || pinT.value === undefined) return
  e.stopPropagation()
  entryId.value = undefined // the band is hidden while a block is highlighted
  tdrag.value = { type: 'pin', x0: e.clientX, t0: pinT.value, moved: false }
  track.value!.setPointerCapture(e.pointerId)
}

function onEdgeDown(e: PointerEvent, edge: 'start' | 'end'): void {
  if (e.button !== 0) return
  e.stopPropagation()
  tdrag.value = { type: 'edge', edge }
  track.value!.setPointerCapture(e.pointerId)
}

function onResizeDown(e: PointerEvent, entry: Entry, edge: 'start' | 'end'): void {
  if (e.button !== 0) return
  e.stopPropagation()
  if (entry.outlook) return
  tdrag.value = { type: 'resize', id: entry.id, edge, start: entry.start, end: entry.end, x0: e.clientX, moved: false }
  track.value!.setPointerCapture(e.pointerId)
}

function onTrackMove(e: PointerEvent): void {
  const d = tdrag.value
  if (!d) {
    // between the fanned-out notes: no time line behind them
    hoverT.value = (e.target as HTMLElement | null)?.closest?.('.fanzone, [data-note]') ? undefined : timeAt(e.clientX, false)
    return
  }
  if (e.buttons === 0) return void onTrackUp(e)
  if (d.type === 'pan') {
    const r = track.value!.getBoundingClientRect()
    const a = d.from0 + ((d.x0 - e.clientX) / r.width) * d.span
    vp.setRange([a, a + d.span])
    return
  }
  const t = timeAt(e.clientX)
  if (d.type === 'create') {
    d.t1 = t
    d.moved ||= Math.abs(e.clientX - d.x0) > 4
    if (d.moved) {
      pinT.value = undefined
      sel.preview(makeSel(Math.min(d.t0, d.t1), Math.max(d.t0, d.t1)))
    }
  } else if (d.type === 'pin') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    if (d.moved) sel.preview(makeSel(Math.min(d.t0, t), Math.max(d.t0, t)))
  } else if (d.type === 'move') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 4 || Math.abs(e.clientY - d.y0) > 6
    if (!d.moved) return
    const r = track.value!.getBoundingClientRect()
    const raw = rawTime(e.clientX) - d.offset
    const start = Math.min(snap(raw, snapPoints.value, (to.value - from.value) / r.width), dayEnd(today.value) - d.dur)
    d.start = Math.max(dayStart(today.value), start)
    // vertical: the row under the pointer (one empty lane below is allowed), only if that slot is free
    const row = rowMain.value?.getBoundingClientRect()
    if (row && e.clientY >= row.top - 4) {
      const want = Math.max(0, Math.min(Math.floor((e.clientY - row.top) / (LANE_H + LANE_GAP)), totalLanes.value))
      if (want !== d.lane && laneIsFree(data.value.entries, want, d.start, d.start + d.dur, d.id)) d.lane = want
    }
    resized.value = { id: d.id, start: d.start, end: d.start + d.dur, lane: d.lane }
  } else if (d.type === 'resize') {
    d.moved ||= Math.abs(e.clientX - d.x0) > 3
    if (!d.moved) return
    if (d.edge === 'start') d.start = Math.min(t, d.end - MINUTE)
    else d.end = Math.max(t, d.start + MINUTE)
    resized.value = { id: d.id, start: d.start, end: d.end }
  } else {
    const s = sel.selection.value
    if (!s) return
    const end = s.end ?? now.value
    if (d.edge === 'start') sel.preview({ ...s, start: Math.min(t, end - MINUTE) })
    else sel.preview(makeSel(s.start, Math.max(t, s.start + MINUTE)))
  }
}

/** Keep the dragged geometry on screen until the saved state comes back — no snap-back flicker. */
async function saveGeometry(id: string, start: Ms, end: Ms, overlap: boolean): Promise<void> {
  const entry = data.value.entries.find((x) => x.id === id)
  // the lane the block is shown on right now is the lane it keeps (what you see is what you get)
  const lane = laneOf(id)
  if (!entry || (entry.start === start && entry.end === end && (entry.lane ?? laneOf(id)) === lane)) {
    resized.value = undefined
    return
  }
  await window.qa.saveEntry(today.value, { ...entry, start, end, lane }, { overlap })
  setTimeout(() => resized.value?.id === id && (resized.value = undefined), 2000)
}

async function onTrackUp(e: PointerEvent): Promise<void> {
  const d = tdrag.value
  tdrag.value = undefined
  if (!d) return
  if (d.type === 'resize') {
    if (d.moved) return saveGeometry(d.id, d.start, d.end, true)
    const entry = data.value.entries.find((x) => x.id === d.id)
    if (entry) clickEntry(entry, d.edge === 'start' ? entry.start : entry.end) // tiny block: an edge click still selects
    return
  }
  if (d.type === 'move') {
    if (d.moved) return saveGeometry(d.id, d.start, d.start + d.dur, true)
    const entry = data.value.entries.find((x) => x.id === d.id)
    if (entry) clickEntry(entry, Math.min(Math.max(d.t0, from.value), now.value))
    return
  }
  if (d.type === 'pan') return
  if (d.type === 'edge') return sel.commit(sel.selection.value)
  if (d.type === 'pin') {
    if (!d.moved) return
    entryId.value = undefined
    pinT.value = undefined
    return sel.commit(sel.selection.value)
  }
  if (d.moved) {
    entryId.value = undefined
    multi.value = new Set()
    return sel.commit(sel.selection.value)
  }
  // plain click
  const hit = d.hitId ? data.value.entries.find((x) => x.id === d.hitId) : undefined
  if (hit && d.ctrl) return toggleMulti(hit.id)
  if (hit) return clickEntry(hit, d.t0)
  multi.value = new Set()
  entryId.value = undefined
  sel.clear()
  pinT.value = d.t0
}

function toggleMulti(id: string): void {
  const s = new Set(multi.value)
  // the block selected by a plain click joins the multi-selection
  if (entryId.value && !s.size) s.add(entryId.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  multi.value = s
  entryId.value = undefined
}

/** With a selection: "continue that topic" (copy kind/text); otherwise highlight the block + divider. */
function clickEntry(entry: Entry, t?: Ms): void {
  multi.value = new Set()
  if (edit.value && edit.value.id === entry.id) return
  if (marker.value) return copyFrom(entry)
  entryId.value = entry.id
  pinT.value = t
}

// the saved state caught up with the dragged geometry → drop the local preview
watch(
  () => data.value.entries,
  (list) => {
    const r = resized.value
    if (r && list.some((e) => e.id === r.id && e.start === r.start && e.end === r.end && (r.lane === undefined || e.lane === r.lane))) resized.value = undefined
  },
)

function copyFrom(e: Entry): void {
  kind.value = e.kind
  label.value = e.label
  flash(`Продолжение: ${kindLabel(e.kind)} · ${e.label}`, true)
  void nextTick(() => labelInput.value?.focus())
}

const hoverInfo = computed(() => {
  if (hoverT.value === undefined) return undefined
  const i = infoAt(entries.value === data.value.entries ? data.value : { ...data.value, entries: entries.value }, hoverT.value)
  const parts = [formatHM(i.t)]
  if (i.entry) parts.push(`${kindLabel(i.entry.kind)}: ${i.entry.label}`)
  for (const p of i.parallel) parts.push(`∥ ${kindLabel(p.kind)}: ${p.label}`)
  if (i.activity) parts.push(i.activity.title ? `${i.activity.app} — ${i.activity.title}` : i.activity.app)
  if (i.call) parts.push(`созвон ${i.call.app}`)
  if (!i.pcOn) parts.push('QA выключено')
  return parts.join(' · ')
})

// ---------- right-click menu ----------

const menu = ref<{ x: number; y: number; entryId?: string; multi?: boolean; title: string; planId?: string }>()
/** Plan blocks already turned into real ones. */
const planDoneIds = computed(() => new Set((data.value.plan ?? []).filter((p) => p.doneEntryId && data.value.entries.some((e) => e.id === p.doneEntryId)).map((p) => p.id)))
async function planMenu(action: 'done' | 'delete'): Promise<void> {
  const id = menu.value?.planId
  menu.value = undefined
  if (!id) return
  if (action === 'done') await window.qa.planDone(today.value, id)
  else await window.qa.deletePlan(today.value, id)
}
const menuBounds = computed(() => {
  const r = panel.value?.getBoundingClientRect()
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : undefined
})

function onTrackContext(e: MouseEvent): void {
  const hit = entryAt(e.clientX, e.clientY)
  if (multi.value.size >= 2 && (!hit || multi.value.has(hit.id))) {
    menu.value = { x: e.clientX, y: e.clientY, multi: true, title: `Выбрано блоков: ${multi.value.size}` }
    return
  }
  if (hit) {
    if (hit.outlook) return flash('Встреча из Outlook — её меняет только Outlook', false)
    menu.value = { x: e.clientX, y: e.clientY, entryId: hit.id, title: 'Изменить вид' }
    return
  }
  const t = timeAt(e.clientX, false)
  // the dashed plan under the blocks: its own menu
  const pl = ui.value.island.plan ? (data.value.plan ?? []).find((p) => t >= p.start && t < p.end) : undefined
  if (pl) {
    menu.value = { x: e.clientX, y: e.clientY, title: `План · ${pl.label}`, planId: pl.id }
    return
  }
  const m = marker.value
  if (!m || t < m.start || t > (m.end ?? now.value)) {
    const g = gapAround(data.value, t, now.value)
    if (g.end - g.start < MINUTE) return
    sel.commit(makeSel(g.start, g.end))
  }
  menu.value = { x: e.clientX, y: e.clientY, title: 'Отметить как' }
}

async function deleteFromMenu(): Promise<void> {
  const m = menu.value
  menu.value = undefined
  if (!m) return
  const ids = m.multi ? [...multi.value] : m.entryId ? [m.entryId] : []
  if (ids.length === 1) {
    const e = data.value.entries.find((x) => x.id === ids[0])
    if (e) await removeOne(e)
  } else for (const id of ids) if (!data.value.entries.find((x) => x.id === id)?.outlook) await window.qa.deleteEntry(today.value, id)
  if (entryId.value && ids.includes(entryId.value)) entryId.value = undefined
  multi.value = new Set()
}

async function mergeSelected(): Promise<void> {
  menu.value = undefined
  const merged = await window.qa.mergeEntries(today.value, [...multi.value])
  multi.value = new Set()
  if (merged) {
    entryId.value = merged.id
    flash(`Объединено: ${formatHM(merged.start)}–${formatHM(merged.end)}`, true)
  }
}

async function onMenuPick(k: string): Promise<void> {
  const m = menu.value
  menu.value = undefined
  if (!m) return
  if (m.multi || m.entryId) {
    const ids = m.multi ? [...multi.value] : [m.entryId!]
    for (const id of ids) {
      const entry = data.value.entries.find((x) => x.id === id)
      // a label that was just the old kind's name follows the new kind
      if (entry) await window.qa.saveEntry(today.value, { ...entry, kind: k, label: entry.label === kindLabel(entry.kind) ? kindLabel(k) : entry.label }, { overlap: true })
    }
    return
  }
  kind.value = k
  await cut()
}

/** Blocks scrolled/zoomed out of view, per side — shown as "<N" / ">N"; a click brings the outermost one back. */
const hidden = computed(() => {
  const list = entries.value
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
  if (side === 'left') vp.panBy(hidden.value.first - pad - from.value)
  else vp.panBy(hidden.value.last + pad - to.value)
}

/** Parallel blocks get their own lanes; the row grows up to 3 lanes, more lanes scroll. */
const LANE_H = 30
const LANE_GAP = 3
/** Lanes in use; one more empty lane is always shown below so a block can be dropped there. */
const totalLanes = computed(() => Math.max(1, ...allSegs.value.map((x) => x.lanes)))
const shownLanes = computed(() => totalLanes.value + 1)
const rowStyle = computed(() => ({ height: `${Math.min(shownLanes.value, 3) * (LANE_H + LANE_GAP) - LANE_GAP}px` }))
const rowInnerStyle = computed(() => ({ height: `${shownLanes.value * (LANE_H + LANE_GAP) - LANE_GAP}px` }))
const rowMain = ref<HTMLElement>()
const layer = ref<InstanceType<typeof LinkLayer>>()
function laneStyle(s: { lane: number; lanes: number }): Record<string, string> {
  return { top: `${s.lane * (LANE_H + LANE_GAP)}px`, height: `${LANE_H}px`, bottom: 'auto' }
}

// ---------- day list ----------

const LIST_KEY = 'qa.island.list'
function readList(): { open: boolean; tab: 'entries' | 'apps' } {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? '{}')
    return { open: v.open !== false, tab: v.tab === 'apps' ? 'apps' : 'entries' }
  } catch {
    return { open: true, tab: 'entries' }
  }
}
const listTab = ref<'entries' | 'apps'>(readList().tab)
/** The journal in the island folds; the state survives restarts. */
const listOpen = ref(readList().open)
watch([listOpen, listTab], () => {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify({ open: listOpen.value, tab: listTab.value }))
  } catch {
    // storage unavailable — just don't remember
  }
})
function toggleList(): void {
  listOpen.value = !listOpen.value
}
function openList(tab: 'entries' | 'apps'): void {
  listTab.value = tab
  listOpen.value = true
}
const dayEntries = computed(() => [...data.value.entries].sort((a, b) => a.start - b.start || (a.lane ?? 0) - (b.lane ?? 0)))
const labelledMs = computed(() => unionMs(data.value.entries))
/** The block each note belongs to (by time). */
const noteOwner = computed(() => new Map(visibleNotes(data.value.notes).map((n) => [n.id, noteEntry(n, data.value.entries)])))
const notesOf = (id: string) => visibleNotes(data.value.notes).filter((n) => noteOwner.value.get(n.id)?.id === id)
/** List rows: blocks in time order, each followed by its notes; notes outside any block by their time. */
const listRows = computed(() => {
  const rows: Array<{ type: 'entry'; e: Entry } | { type: 'note'; n: Note; owned: boolean }> = []
  const orphans = visibleNotes(data.value.notes).filter((n) => !noteOwner.value.get(n.id))
  let oi = 0
  for (const e of dayEntries.value) {
    while (oi < orphans.length && orphans[oi].at < e.start) rows.push({ type: 'note', n: orphans[oi++], owned: false })
    rows.push({ type: 'entry', e })
    for (const n of notesOf(e.id)) rows.push({ type: 'note', n, owned: true })
  }
  while (oi < orphans.length) rows.push({ type: 'note', n: orphans[oi++], owned: false })
  return rows
})
/** Apps for the marker if there is one, otherwise for the whole day so far. */
const appsRange = computed<[Ms, Ms]>(() => {
  if (marker.value) return [marker.value.start, activeEnd.value]
  const first = data.value.spans.length ? Math.min(...data.value.spans.map((s) => s.start)) : dayStart(today.value)
  return [first, now.value]
})
const appsBreakdown = computed(() => breakdown(data.value, appsRange.value[0], appsRange.value[1]))
const appsTotal = computed(() => Math.max(1, appsRange.value[1] - appsRange.value[0]))
const appsRangeLabel = computed(() => (marker.value ? `за ${formatHM(appsRange.value[0])}–${formatHM(appsRange.value[1])}` : 'за день'))

function openEntryMenu(e: MouseEvent, entry: Entry): void {
  if (entry.outlook) return flash('Встреча из Outlook — её меняет только Outlook', false)
  menu.value = { x: e.clientX, y: e.clientY, entryId: entry.id, title: 'Изменить вид' }
}

// ---------- cutting ----------

const entryId = ref<string>()
const selectedEntry = computed(() => data.value.entries.find((e) => e.id === entryId.value))
const kind = ref<EntryKind>('task')
const label = ref('')
const saving = ref(false)
const toast = ref<{ text: string; ok: boolean }>()

function setStart(t: Ms): void {
  const a = active.value
  if (a) sel.commit({ ...a, start: Math.min(t, activeEnd.value - MINUTE) })
}
function setEnd(t: Ms): void {
  const a = active.value
  if (a) sel.commit(makeSel(a.start, Math.max(t, a.start + MINUTE)))
}
/** Nothing uncut: an explicit period from now (e.g. to plan a block ahead) — adjust its times as needed. */
function planPeriod(): void {
  sel.commit({ day: today.value, start: Math.round(now.value / MINUTE) * MINUTE, end: Math.round(now.value / MINUTE) * MINUTE + 30 * MINUTE })
}

const detectedCalls = computed(() =>
  data.value.calls
    .filter((c) => c.end - c.start >= 2 * MINUTE)
    .filter((c) => !data.value.entries.some((e) => e.kind === 'call' && e.start < c.end && e.end > c.start))
    .slice(-2),
)

function pickKind(k: string): void {
  kind.value = k
  if (k === 'call') {
    // jump to the latest detected call that is not labelled yet
    const call = detectedCalls.value[detectedCalls.value.length - 1]
    if (call && !marker.value) sel.commit(makeSel(call.start, call.end))
  }
  void nextTick(() => labelInput.value?.focus())
}

function useCall(c: { start: Ms; end: Ms; app: string }): void {
  kind.value = 'call'
  sel.commit(makeSel(c.start, c.end))
  if (!label.value) label.value = `Созвон ${c.app}`
}

type Dictation = { blob: Blob; durationSec: number; at: number; kind: 'voice' | 'call' }
async function cut(dict?: Dictation): Promise<void> {
  if (saving.value) return
  const parts = splitTitle(label.value)
  let text = parts.label
  let range = active.value ? { start: active.value.start, end: activeEnd.value } : undefined
  // "30м созвон" (in the title line) without a marker → the last 30 minutes
  const quick = !marker.value ? parseQuickDuration(text) : undefined
  if (quick) {
    range = { start: now.value - quick.minutes * MINUTE, end: now.value }
    text = quick.rest.trim()
  }
  if (!range) return flash('Нечего отрезать — выделите участок шкалы', false)
  if (range.end - range.start < MINUTE) return flash('Слишком короткий отрезок', false)
  saving.value = true
  try {
    // one block per linked task (parallel, on free lanes); without a task — one block
    const targets: Array<TaskRef | undefined> = cutTasks.value.length ? cutTasks.value.map(plainTask) : [undefined]
    let firstId: string | undefined
    for (const t of targets) {
      const saved = await window.qa.saveEntry(today.value, {
        ...range,
        kind: kind.value,
        // a meeting or a break needs no description — the kind itself (or the linked task) is the label;
        // dictated: a placeholder until the transcript fills it
        label: text || (dict ? VOICE_PENDING : t ? `${t.key} ${t.summary}` : kindLabel(kind.value)),
        description: parts.description,
        task: t,
        source: 'manual',
      }, { overlap: true }) // other blocks under the new one stay — they go parallel
      firstId ??= saved.id
    }
    // links picked for the new block
    if (firstId && cutLinks.value.length) await window.qa.setLinks(today.value, { type: 'entry', id: firstId }, cutLinks.value.map((l) => ({ ...l })))
    // the dictation is kept as an audio note linked to the block; its transcript fills the block's text
    if (dict && firstId) void saveRecording(today.value, { ...dict, at: range.start }, { entryId: firstId })
    flash(`Сохранено · ${targets.length > 1 ? tasksWord(targets.length) : kindLabel(kind.value)} · ${formatDuration(range.end - range.start)}`, true)
    if (marker.value) sel.clear()
    label.value = ''
    kind.value = 'task'
    cutTasks.value = []
    cutLinks.value = []
  } catch (e) {
    flash(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), false)
  } finally {
    saving.value = false
  }
}

// ---------- inline edit ----------

const edit = ref<{ id: string; start: Ms; end: Ms; label: string; kind: EntryKind; tasks: TaskRef[]; links: LinkEnd[] }>()
/** The Jira task(s) the next cut goes to — several → one parallel block per task. */
const cutTasks = ref<TaskRef[]>([])
/** What the next cut is linked with. */
const cutLinks = ref<LinkEnd[]>([])
const linksOf = (e: LinkEnd) => linkedTo(data.value.links ?? [], e).map((x) => x.other)
/** Linked things of the selected block, for the details line. */
const selectedLinks = computed(() =>
  selectedEntry.value
    ? linksOf({ type: 'entry', id: selectedEntry.value.id }).flatMap((o) => {
        if (o.type === 'entry') {
          const e = data.value.entries.find((x) => x.id === o.id)
          return e ? [{ key: `e${e.id}`, icon: entryIcon(e), color: kindColor(e.kind), text: `${formatHM(e.start)} ${e.label || kindLabel(e.kind)}`, open: () => (entryId.value = e.id) }] : []
        }
        const n = data.value.notes.find((x) => x.id === o.id)
        return n ? [{ key: `n${n.id}`, icon: noteIcon(n), color: '#fbbf24', text: `${formatHM(n.at)} ${n.text || n.transcript || 'Заметка'}`, open: () => openPanelNote(n) }] : []
      })
    : [],
)
const onLink = (a: LinkEnd, b: LinkEnd) => void window.qa.link(today.value, a, b)
const onUnlink = (id: string) => void window.qa.unlink(today.value, id)
watch(entryId, () => (edit.value = undefined))

function startEdit(e: Entry): void {
  if (e.outlook) return flash('Встреча из Outlook — её меняет только Outlook', false)
  edit.value = { id: e.id, start: e.start, end: e.end, label: joinTitle(e.label, e.description), kind: e.kind, tasks: e.task ? [e.task] : [], links: linksOf({ type: 'entry', id: e.id }) }
}

async function saveEdit(): Promise<void> {
  const ed = edit.value
  const entry = ed && data.value.entries.find((x) => x.id === ed.id)
  if (!ed || !entry) return
  if (ed.end - ed.start < MINUTE) return flash('Слишком короткий отрезок', false)
  const next = {
    ...entry,
    start: ed.start,
    end: ed.end,
    kind: ed.kind,
    label: splitTitle(ed.label).label || (ed.tasks[0] ? `${ed.tasks[0].key} ${ed.tasks[0].summary}` : kindLabel(ed.kind)),
    description: splitTitle(ed.label).description,
    task: plainTask(ed.tasks[0]),
  }
  // one of a series: this one or all of them
  if (entry.series) {
    const scope = await askSeries('save')
    if (!scope) return
    if (scope === 'all') {
      await window.qa.seriesSave(today.value, next)
      await window.qa.setLinks(today.value, { type: 'entry', id: ed.id }, ed.links.map((l) => ({ ...l })))
      edit.value = undefined
      return flash('Изменения применены ко всей серии', true)
    }
  }
  await window.qa.saveEntry(
    today.value,
    {
      ...entry,
      start: ed.start,
      end: ed.end,
      kind: ed.kind,
      lane: entry.lane ?? laneOf(entry.id),
      label: splitTitle(ed.label).label || (ed.tasks[0] ? `${ed.tasks[0].key} ${ed.tasks[0].summary}` : kindLabel(ed.kind)),
      description: splitTitle(ed.label).description,
      task: plainTask(ed.tasks[0]),
    },
    { overlap: true },
  )
  await window.qa.setLinks(today.value, { type: 'entry', id: ed.id }, ed.links.map((l) => ({ ...l })))
  edit.value = undefined
  flash('Изменения сохранены', true)
}

async function removeEntry(): Promise<void> {
  const e = selectedEntry.value
  if (!e) return
  if (e.outlook) return flash('Встреча из Outlook — её меняет только Outlook', false)
  await removeOne(e)
  entryId.value = undefined
}
/** One block deleted — for a repeated one: it alone or the whole series. */
async function removeOne(e: Entry): Promise<void> {
  if (e.outlook) return
  if (e.series) {
    const scope = await askSeries('delete')
    if (!scope) return
    if (scope === 'all') return void (await window.qa.seriesDelete(today.value, e.id))
  }
  await window.qa.deleteEntry(today.value, e.id)
}

function flash(text: string, ok: boolean): void {
  toast.value = { text, ok }
  setTimeout(() => toast.value?.text === text && (toast.value = undefined), 2600)
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (panelNote.value) panelNote.value = undefined // the editor saves on its way out
  else if (menu.value) menu.value = undefined
  else if (edit.value) edit.value = undefined
  else if (multi.value.size) multi.value = new Set()
  else if (entryId.value || pinT.value !== undefined) {
    entryId.value = undefined
    pinT.value = undefined
  }
  else if (marker.value) sel.clear()
  else {
    engaged.value = false
    setExpanded(false)
  }
}
</script>

<template>
  <SeriesAsk />
  <div class="stage" :class="[{ up }, dock ? `dock-${dock}` : '']" @keydown="onKey">
    <div ref="shell" class="shell" :class="{ expanded }" :style="{ width: `${size.w}px`, height: `${size.h}px`, marginTop: `${shellTop}px`, '--bga': bgAlpha }">
      <!-- ===== collapsed pill ===== -->
      <Transition name="ifade">
        <div v-if="!expanded" class="pill" :class="{ docked: !!dock && !noteOpen }" :style="{ height: dock && !noteOpen ? '100%' : `${pillH}px` }" @click="!noteOpen && setExpanded(true)">
          <span ref="pillHandle" class="handle drag" title="Переместить">
            <Icon name="grip" :size="16" />
          </span>
          <div class="pinfo">
            <div ref="plineEl" class="pline">
              <span class="dot" :class="status.cls"></span>
              <span class="pstatus" :class="status.cls">{{ status.text }}</span>
              <span v-if="pillInfo && ui.pill.app" class="papp">{{ pillInfo }}</span>
              <span
                v-if="comboOn && ui.pill.combo"
                class="pcombo"
                :class="{ live: typing }"
                :title="`Комбо — нажатия клавиш с паузами меньше 3 с. Лучшее за день: ${combo.best}${combo.bestAt ? ` (в ${formatHM(combo.bestAt)})` : ''}`"
              >
                <Icon name="keyboard" :size="12" />
                <span v-if="typing" class="cwrap" :style="{ transform: `scale(${1 + heat * 0.15})` }">
                  <span
                    :key="combo.current"
                    class="cnum"
                    :style="{ '--amp': `${0.2 + heat * 0.7}px`, color: `color-mix(in srgb, #ef4444 ${Math.round(heat * 100)}%, #e2e8f0)` }"
                    >{{ combo.current }}</span
                  >
                </span>
                <span v-else class="cbest">{{ combo.best }}</span>
              </span>
              <ActivityWave v-if="dock && !noteOpen ? ui.dock.wave : ui.pill.wave" class="pwave" title="Активность" />
              <span v-else class="pfill"></span>
              <span class="pend">
                <span v-if="marker" class="pmarker">
                  <Icon name="scissors" :size="11" />{{ formatHM(marker.start) }}–{{ marker.end ? formatHM(marker.end) : 'сейчас' }}
                </span>
                <span v-if="ui.pill.date" class="pday">{{ dateText }}</span>
                <span v-if="dock && !noteOpen && ui.dock.next && nextMeeting" class="pnext" :title="`До встречи «${nextMeeting.label}» в ${formatHM(nextMeeting.start)}`"><Icon name="calendar" :size="11" />{{ nextIn }}</span>
                <b
                  v-if="!dock || noteOpen || ui.dock.time"
                  class="ptime"
                  :title="`Продуктивно ${formatDuration(productive)}${workMs ? ` (${productivePct}% рабочего дня)` : ''}: в рабочие часы ${formatDuration(split.within)}, сверх ${formatDuration(split.over)}. Не размечено за день ${formatDuration(unlabelled)}, в приложениях ${formatDuration(appsMs)}.`"
                  >{{ formatDuration(productive) }}</b
                >
              </span>
            </div>
            <div v-if="ui.pill.chips" ref="chipsEl" class="chips">
              <template v-for="it in pillItems" :key="it.type === 'entry' ? it.e.id : it.type === 'note' ? `n${it.n.id}` : it.type === 'plan' ? `p${it.p.id}` : `u${it.t}`">
                <span
                  v-if="it.type === 'entry'"
                  class="pchip"
                  :style="{ background: kindColor(it.e.kind) }"
                  :title="`${kindLabel(it.e.kind)} · ${it.e.label} · ${formatHM(it.e.start)}–${formatHM(it.e.end)} · ${formatDuration(it.e.end - it.e.start)}`"
                >
                  <Icon :name="entryIcon(it.e)" :size="11" :stroke="2.4" />
                  <span v-if="it.e.task" class="ckey">{{ it.e.task.key }}</span>
                  <span>{{ chipText(it.e.end - it.e.start) }}</span>
                </span>
                <span
                  v-else-if="it.type === 'plan'"
                  class="pchip pplan"
                  :style="{ '--c': kindColor(it.p.kind) }"
                  :title="`План: ${it.p.task ? it.p.task.key + ' ' : ''}${it.p.label} · ${formatHM(it.p.start)}–${formatHM(it.p.end)}`"
                ><Icon :name="entryIcon(it.p)" :size="11" :stroke="2.4" />{{ chipText(it.p.end - it.p.start) }}</span>
                <span v-else-if="it.type === 'note'" class="pchip pnotechip" :title="noteTitle(it.n)"><Icon :name="noteIcon(it.n)" :size="11" :stroke="2.4" /></span>
                <span v-else class="pchip" :class="it.live ? 'live' : 'gap'" :title="`Не размечено ${formatHM(it.t)}–${it.live ? 'сейчас' : formatHM(it.t + it.ms)}`"><span v-if="it.live" class="pulse"></span>{{ formatDuration(it.ms) }}</span>
              </template>
              <span v-if="!pillItems.length" class="muted pempty">записей пока нет</span>
            </div>
            <div v-if="ui.pill.stats" ref="statsEl" class="pstats">
              <span v-for="[k, ms] in kindTotals" :key="k" class="st" :title="`${kindLabel(k)} — всего за день`">
                <Icon :name="kindIcon(k)" :size="11" :stroke="2.2" :style="{ color: kindColor(k) }" />{{ formatDuration(ms) }}
              </span>
              <span v-for="[key, t] in taskTotals" :key="key" class="st jt" :title="`${key} — ${t.summary}: всего за день`">
                <Icon name="jira" :size="11" />{{ key }} {{ formatDuration(t.ms) }}
              </span>
              <span v-if="unlabelled >= 60000" class="st" title="Не размечено"><i class="stripe"></i>{{ formatDuration(unlabelled) }}</span>
              <span v-if="workMs" class="st pct" :title="pctTitle">{{ productivePct }}% полезного</span>
            </div>
          </div>
          <button v-if="!dock || noteOpen || ui.dock.orb" ref="orbEl" class="orb-btn" :class="{ on: noteOpen, rec: !!recording }" :title="recording ? 'Идёт запись — клик: открыть' : mascot.title" @click.stop="toggleNote">
            <ThinkingOrb :state="mascot.state" :size="dock && !noteOpen ? 20 : 32" :px="dock && !noteOpen ? 24 : 40" :speed="mascot.speed" :tint="mascot.tint" />
          </button>
          <div v-if="noteOpen && note" class="pnote" @click.stop>
            <div class="nhead">
              <span class="qtabs">
                <button :class="{ on: qtab === 'text' }" @click="qtab = 'text'"><Icon name="note" :size="12" />Текст</button>
                <button :class="{ on: qtab === 'audio' }" @click="qtab = 'audio'"><Icon name="mic" :size="12" />Аудио</button>
                <button :class="{ on: qtab === 'event' }" @click="qtab = 'event'"><Icon name="plus" :size="12" />Событие</button>
                <button :class="{ on: qtab === 'call', hot: live.inCall }" @click="qtab = 'call'"><Icon name="phone" :size="12" />Звонок</button>
              </span>
              <span v-if="noteTarget && qtab !== 'event'" class="ntarget">→ {{ noteTarget }}</span>
              <span class="spacer"></span>
              <span v-if="qMsg" class="qmsg">{{ qMsg }}</span>
            </div>

            <template v-if="qtab === 'text'">
              <div class="qrow">
                <textarea
                  ref="noteArea"
                  v-model="note.text"
                  class="ntext"
                  placeholder="Мысль, договорённость, ссылка… (Markdown)"
                  spellcheck="false"
                  @input="onNoteInput"
                  @keydown.stop="onNoteKey"
                ></textarea>
                <div class="qside">
                  <button class="qbtn" :disabled="!note.text.trim()" title="Сделать задачей" @click="quickToTask"><Icon name="checkSquare" :size="13" />В задачу</button>
                  <LinkPicker
                    v-model="nLinks"
                    class="qnl"
                    :entries="data.entries"
                    :notes="data.notes"
                    :self="{ type: 'note', id: note.id }"
                    :near="note.at"
                    compact
                    labeled
                    @open="(on) => (qLinksOpen = on)"
                  />
                </div>
              </div>
            </template>

            <div v-else-if="qtab === 'audio'" class="qrec">
              <template v-if="recording?.kind === 'voice'">
                <button class="recbtn on" title="Остановить и сохранить" @click="stopRec"><Icon name="stop" :size="14" /></button>
                <span class="meter"><span :style="{ width: `${recLevel * 100}%` }"></span></span>
                <b class="rt">{{ fmtRec(recSec) }}</b>
              </template>
              <template v-else>
                <button class="recbtn" :disabled="!!recording" title="Записать голосовую заметку" @click="startRec('voice')"><Icon name="mic" :size="16" /></button>
                <span class="muted small">{{ recording ? 'Идёт запись звонка' : 'Нажмите и говорите — расшифровка локально' }}</span>
              </template>
            </div>

            <div v-else-if="qtab === 'event'" class="qev">
              <div class="qtop">
                <span class="qkinds">
                  <button v-for="k in shownKinds" :key="k.id" :class="{ on: qKind === k.id }" :style="qKind === k.id ? { background: k.color } : {}" :title="k.label" @click="qKind = k.id">
                    <Icon :name="k.icon" :size="13" />
                  </button>
                </span>
                <OffsetField v-model="qOff" :max="240" class="qoff" />
              </div>
              <div class="qrow">
                <textarea v-model="qLabel" class="qlabel" :placeholder="`${kindLabel(qKind)} — Enter: добавить, Shift+Enter: новая строка`" spellcheck="false" @keydown.stop @keydown.enter.exact.prevent="addQuickEvent()"></textarea>
                <DictateButton compact @recorded="(r) => addQuickEvent(r)" />
                <LinkPicker v-model="qLinks" class="qlp" :entries="data.entries" :notes="data.notes" compact @open="(on) => (qLinksOpen = on)" />
                <button class="qbtn ok" @click="addQuickEvent()"><Icon name="check" :size="14" />Добавить</button>
              </div>
            </div>

            <div v-else class="qrec">
              <template v-if="recording?.kind === 'call'">
                <button class="recbtn on" title="Остановить запись звонка" @click="stopRec"><Icon name="stop" :size="14" /></button>
                <span class="meter"><span :style="{ width: `${recLevel * 100}%` }"></span></span>
                <b class="rt">{{ fmtRec(recSec) }}</b>
              </template>
              <template v-else>
                <button class="recbtn" :disabled="!!recording" title="Записать звонок" @click="startRec('call')"><Icon name="phone" :size="15" /></button>
                <span class="muted small">{{ live.inCall ? 'Идёт созвон — записать звук собеседников и микрофон' : 'Запись звука компьютера и микрофона' }}. Предупредите участников о записи.</span>
              </template>
            </div>
          </div>
        </div>
      </Transition>

      <!-- ===== expanded panel ===== -->
      <Transition name="ifade">
        <div v-if="expanded" ref="panel" class="panel" @focusin="onFocusIn" @focusout="onFocusOut">
          <div class="head" @click="onHeadClick">
            <span class="drag dragzone" title="Переместить">
              <span class="handle"><Icon name="grip" :size="16" /></span>
              <Icon name="qlogo" :size="18" :stroke="3.6" class="logo" />
              <b>Qvarch</b>
            </span>
            <span v-if="ui.island.date" class="muted small">{{ dateText }}</span>
            <ActivityWave v-if="ui.island.wave" class="hwave" title="Активность" />
            <span class="total" title="Продуктивное время"><small>в работе</small> {{ formatDuration(productive) }}</span>
            <span class="status" :class="status.cls">{{ status.text }}</span>
            <button class="icon" :class="{ on: !!panelNote }" title="Новая заметка" @click="openPanelNote()"><Icon name="note" :size="15" /></button>
            <button class="icon" :class="{ on: pinned }" :title="pinned ? 'Открепить' : 'Закрепить развёрнутым'" @click="togglePin">
              <Icon name="pin" :size="15" />
            </button>
            <button class="icon" title="Открыть приложение" @click="openMain()"><Icon name="external" :size="15" /></button>
          </div>

          <div class="axis" @click="resetSelection">
            <i v-for="t in axis.minor" :key="`m${t}`" class="tk minor" :style="{ left: `${pct(t)}%` }"></i>
            <i v-for="t in axis.all" :key="`M${t}`" class="tk" :style="{ left: `${pct(t)}%` }"></i>
            <span v-for="t in axis.list" :key="t" :style="{ left: `${pct(t)}%` }">{{ formatHM(t) }}</span>
            <span v-for="m in axis.marks" :key="m.text" :class="m.cls" :style="{ left: `${pct(m.t)}%` }">{{ m.text }}</span>
            <span v-if="now <= to" class="nowlbl" :style="{ left: `${Math.min(pct(now), 88)}%` }">Сейчас {{ formatHM(now) }}</span>
          </div>

          <div
            ref="track"
            class="track"
            @wheel.prevent="vp.onWheel($event, track!)"
            @pointerdown="onTrackDown"
            @pointermove="onTrackMove"
            @pointerup="onTrackUp"
            @pointerleave="hoverT = undefined"
            @mousedown.middle.prevent
            @contextmenu.prevent="onTrackContext"
          >
            <div v-if="schedule.work" class="sch-work" :style="box(schedule.work[0], schedule.work[1], 0)"></div>
            <template v-if="schedule.work">
              <div v-if="schedule.work[0] > from" class="sch-off" :style="box(from, schedule.work[0], 0)"></div>
              <div v-if="schedule.work[1] < to" class="sch-off" :style="box(schedule.work[1], to, 0)"></div>
            </template>
            <div v-if="schedule.lunch" class="sch-lunch" :style="box(schedule.lunch[0], schedule.lunch[1], 0)"></div>
            <div v-for="(o, i) in off" :key="`o${i}`" class="off" :style="box(o.start, o.end, 0)"></div>
            <div class="row-scroll" :style="rowStyle">
            <div ref="rowMain" class="row-main" :style="rowInnerStyle">
              <div v-for="l in shownLanes" :key="`lane${l}`" class="lane-bg" :style="{ top: `${(l - 1) * (LANE_H + LANE_GAP)}px`, height: `${LANE_H}px` }"></div>
              <!-- the day plan, dashed under the blocks (settings → interface) -->
              <template v-if="ui.island.plan">
                <div
                  v-for="p in data.plan ?? []"
                  :key="`pl${p.id}`"
                  class="planseg"
                  :style="{ ...box(p.start, p.end), top: '0px', height: `${LANE_H}px`, bottom: 'auto', '--c': kindColor(p.kind) }"
                  :title="`План: ${p.task ? p.task.key + ' ' : ''}${p.label} · ${formatHM(p.start)}–${formatHM(p.end)}`"
                ></div>
              </template>
              <div v-if="uncutMs >= 60000" class="uncut" :style="{ ...box(cursor, now), height: LANE_H + 'px', bottom: 'auto' }"></div>
              <div
                v-for="(s, i) in segs"
                :key="`s${i}`"
                class="seg"
                :data-entry="s.entry.id"
                :class="{ sel: s.entry.id === entryId || multi.has(s.entry.id), multi: multi.has(s.entry.id), moving: resized?.id === s.entry.id }"
                :style="{ ...box(s.start, s.end), '--c': kindColor(s.entry.kind), ...laneStyle(s) }"
              >
                <span v-if="s.start === s.entry.start && px(s.start, s.end, TRACK_W) >= 26" class="rh l" @pointerdown="onResizeDown($event, s.entry, 'start')"></span>
                
                <Icon v-if="px(s.start, s.end, TRACK_W) >= 18" :name="entryIcon(s.entry)" :size="12" :stroke="2.2" class="sic" />
                <span v-if="px(s.start, s.end, TRACK_W) >= 54" class="stxt"><b v-if="s.entry.task" class="tkey">{{ s.entry.task.key }}</b> {{ labelWithoutKey(s.entry.label, s.entry.task?.key) }}</span>
                <span v-if="s.end === s.entry.end && px(s.start, s.end, TRACK_W) >= 26" class="rh r" @pointerdown="onResizeDown($event, s.entry, 'end')"></span>
              </div>
            </div>
            </div>
            <div v-if="ui.island.apps" class="row-apps">
              <div
                v-for="(a, i) in activity"
                :key="i"
                class="aseg"
                :class="a.kind"
                :style="{ ...box(a.start, a.end, 0), background: a.kind === 'idle' || a.kind === 'locked' ? undefined : APP_COLORS[a.kind] }"
              ></div>
            </div>
            <Transition name="fade">
              <div v-if="marker && !selectedEntry" class="band" :style="box(marker.start, activeEnd, 0)">
                <span class="cap l" title="Тяните — граница выделения" @pointerdown="onEdgeDown($event, 'start')">{{ formatHM(marker.start) }}</span>
                <span class="cap r" title="Тяните — граница выделения" @pointerdown="onEdgeDown($event, 'end')">{{ marker.end ? formatHM(activeEnd) : 'сейчас' }}</span>
              </div>
            </Transition>
            <div class="nowline" :style="{ left: `${pct(now)}%` }"></div>
            <div
              v-if="fanZone"
              class="fanzone"
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
              class="notepin"
              :class="{ on: panelNote?.id === n.id }"
              :data-note="n.id"
              :style="{ left: `${pct(n.at)}%`, transform: fan.shift(pinPlaces.get(n.id), 16), zIndex: 8 + (pinPlaces.get(n.id)?.n ?? 1) - (pinPlaces.get(n.id)?.i ?? 0) }"
              @pointerenter="pinPlaces.get(n.id) && fan.enter(pinPlaces.get(n.id)!.key)"
              @pointerleave="fan.leave()"
              :title="`${noteTitle(n)}\nПотяните к блоку — связать`"
              @pointerdown.stop="layer?.startDrag($event, { type: 'note', id: n.id })"
              @click.stop="openPanelNote(n)"
            >
              <Icon :name="noteIcon(n)" :size="10" :stroke="2.2" />
            </span>
            <button v-if="hidden.left" class="hid l" :title="`Скрыто слева: ${hidden.left}`" @pointerdown.stop @click="revealSide('left')">&lt;{{ hidden.left }}</button>
            <button v-if="hidden.right" class="hid r" :title="`Скрыто справа: ${hidden.right}`" @pointerdown.stop @click="revealSide('right')">&gt;{{ hidden.right }}</button>
            <div v-if="pinT !== undefined && pinT >= from && pinT <= to" class="pinline" :style="{ left: `${pct(pinT)}%` }">
              <span title="Тяните влево или вправо" @pointerdown="onPinDown">{{ formatHM(pinT) }}</span>
            </div>
            <LinkLayer ref="layer" :links="data.links ?? []" :entries="data.entries" :link-style="ui.links.style" :tick="[from, to, segs, rowStyle, ui.island.apps]" @link="onLink" @unlink="onUnlink" />
          </div>

          <div class="legend">
            <Transition name="fade" mode="out-in">
              <span v-if="hoverInfo" key="h" class="hover">{{ hoverInfo }}</span>
              <span v-else-if="ui.island.totals" key="l" class="items totals">
                <span v-for="[k, ms] in kindTotals" :key="k" :title="`${kindLabel(k)} — всего за день`">
                  <Icon :name="kindIcon(k)" :size="13" :stroke="2.2" :style="{ color: kindColor(k) }" /><b>{{ formatDuration(ms) }}</b>
                </span>
                <span v-for="[key, t] in taskTotals" :key="key" class="jt" :title="`${key} — ${t.summary}: всего за день`">
                  <Icon name="jira" :size="13" />{{ key }} <b>{{ formatDuration(t.ms) }}</b>
                </span>
                <span v-if="unlabelled >= 60000" title="Не размечено"><i class="striped"></i><b>{{ formatDuration(unlabelled) }}</b></span>
                <span v-if="workMs" class="pct" :title="pctTitle"><b>{{ productivePct }}%</b> полезного</span>
              </span>
            </Transition>
          </div>

          <div class="divider"></div>

          <Transition name="fade" mode="out-in">
            <!-- a note: new, or opened from its pin -->
            <div v-if="panelNote" :key="`note${panelNote.id}`" class="details">
              <NoteEditor :day="today" :note="panelNote" :entries="data.entries" :full="data.notes.find((x) => x.id === panelNote!.id)" compact @close="panelNote = undefined" />
            </div>

            <!-- selected entry -->
            <div v-else-if="selectedEntry" key="entry" class="details">
              <div class="d-title">
                <span class="kic" :style="{ background: kindColor(selectedEntry.kind) }"><Icon :name="kindIcon(selectedEntry.kind)" :size="13" :stroke="2.2" /></span>
                {{ kindLabel(selectedEntry.kind) }} · {{ selectedEntry.label }}
              </div>
              <div class="d-sub">
                {{ formatHM(selectedEntry.start) }}–{{ formatHM(selectedEntry.end) }} · {{ formatDuration(selectedEntry.end - selectedEntry.start) }}
              </div>
              <div v-if="selectedEntry.task && !edit" class="d-task"><Icon name="checkSquare" :size="12" /><b>{{ selectedEntry.task.key }}</b> {{ selectedEntry.task.summary }}</div>
              <div v-if="selectedEntry.description && !edit" class="d-desc">{{ selectedEntry.description }}</div>
              <div v-if="selectedLinks.length && !edit" class="d-links">
                <Icon name="link" :size="12" class="muted" />
                <button v-for="l in selectedLinks" :key="l.key" class="lchip" :title="l.text" @click="l.open()">
                  <span class="lic" :style="{ background: l.color }"><Icon :name="l.icon" :size="9" :stroke="2.4" /></span>{{ l.text }}
                </button>
              </div>
              <template v-if="!edit">
                <div class="mini-actions">
                  <button @click="startEdit(selectedEntry)"><Icon name="pencil" :size="13" />Изменить</button>
                  <button class="danger" @click="removeEntry"><Icon name="trash" :size="13" />Удалить</button>
                  <span class="spacer"></span>
                  <button title="Открыть в приложении" @click="openMain(selectedEntry.id)"><Icon name="external" :size="13" /></button>
                  <button title="Закрыть (Esc)" @click="entryId = undefined"><Icon name="x" :size="13" /></button>
                </div>
              </template>
              <div v-else class="editbox" @keydown.enter.exact.prevent="saveEdit">
                <div class="times">
                  <TimeField compact :model-value="edit.start" :max="edit.end - 60000" @update:model-value="(t) => (edit!.start = t)" />
                  <span class="muted">—</span>
                  <TimeField compact :model-value="edit.end" :min="edit.start + 60000" :max="dayEnd(today)" @update:model-value="(t) => (edit!.end = t)" />
                  <b class="dur">{{ formatDuration(edit.end - edit.start) }}</b>
                </div>
                <div class="editrow">
                  <LabelInput v-model="edit.label" drop-up no-recent multiline :recent="recent" placeholder="Shift+Enter — новая строка" @submit="saveEdit" />
                  <TaskPicker v-model="edit.tasks" single compact />
                  <LinkPicker v-model="edit.links" :entries="data.entries" :notes="data.notes" :self="{ type: 'entry', id: edit.id }" compact />
                </div>
                <div class="actions">
                  <button class="apply" title="Сохранить (Enter)" @click="saveEdit"><Icon name="check" :size="18" :stroke="2.6" /></button>
                  <div class="kseg">
                    <button
                      v-for="k in shownKinds"
                      :key="k.id"
                      :class="{ on: edit.kind === k.id }"
                      :style="edit.kind === k.id ? { background: k.color } : {}"
                      :title="k.label"
                      @click="edit.kind = k.id"
                    >
                      <Icon :name="k.icon" :size="14" />
                      <span>{{ k.label }}</span>
                    </button>
                  </div>
                  <button class="cancel" title="Отмена (Esc)" @click="edit = undefined"><Icon name="x" :size="16" /></button>
                </div>
              </div>
            </div>

            <!-- marker / uncut tail -->
            <div v-else key="cut" class="details">
              <div class="times">
                <template v-if="marker">
                  <span class="muted">Период</span>
                  <TimeField compact :model-value="marker.start" :max="activeEnd - 60000" @update:model-value="setStart" />
                  <span class="muted">—</span>
                  <TimeField compact :model-value="activeEnd" :live="!marker.end" :min="marker.start + 60000" :max="dayEnd(today)" @update:model-value="setEnd" />
                  <b class="dur">{{ formatDuration(activeEnd - marker.start) }}</b>
                  <button class="icon" title="Сбросить выделение (Esc)" @click="resetSelection"><Icon name="x" :size="15" /></button>
                </template>
                <template v-else-if="implicit">
                  <!-- free work time by default (or an hour forward); changing a time turns it into an explicit period -->
                  <span class="muted">Период</span>
                  <TimeField compact :model-value="implicit.start" :min="dayStart(today)" :max="activeEnd - 60000" @update:model-value="setStart" />
                  <span class="muted">—</span>
                  <TimeField compact :model-value="activeEnd" :live="!implicit.end" :min="implicit.start + 60000" :max="dayEnd(today)" @update:model-value="setEnd" />
                  <b class="dur">{{ formatDuration(activeEnd - implicit.start) }}</b>
                  <span class="muted small">{{ implicit.end ? 'вперёд' : 'свободно' }}</span>
                </template>
                <template v-else>
                  <span class="muted">Всё размечено.</span>
                  <button class="linkbtn" @click="planPeriod">Указать период…</button>
                </template>
              </div>

              <div class="inputrow">
                <LabelInput
                  ref="labelInput"
                  v-model="label"
                  drop-up
                  no-recent
                  :recent="recent"
                  multiline
                  placeholder="Shift+Enter — новая строка"
                  @submit="cut()"
                  @pick="(s) => s.kind && (kind = s.kind)"
                />
                <DictateButton @recorded="(r) => cut(r)" />
                <TaskPicker v-model="cutTasks" compact />
                <LinkPicker v-model="cutLinks" :entries="data.entries" :notes="data.notes" compact />
                <OffsetField compact class="dialoff" :max="240" :model-value="dial" @update:model-value="onDial" @commit="onDial(dial)" />
              </div>

              <div class="actions">
                <button class="apply" title="Применить (Enter)" :disabled="saving" @click="cut()"><Icon name="check" :size="20" :stroke="2.6" /></button>
                <div class="kseg">
                  <button
                    v-for="k in shownKinds"
                    :key="k.id"
                    :class="{ on: kind === k.id }"
                    :style="kind === k.id ? { background: k.color } : {}"
                    :title="k.label"
                    @click="pickKind(k.id)"
                  >
                    <Icon :name="k.icon" :size="14" />
                    <span>{{ k.label }}</span>
                  </button>
                </div>
              </div>

              <div class="foot">
                <Transition name="fade" mode="out-in">
                  <span v-if="toast" :key="toast.text" class="toast" :class="{ bad: !toast.ok }">
                    <Icon :name="toast.ok ? 'check' : 'x'" :size="13" />{{ toast.text }}
                  </span>
                  <span v-else key="calls" class="calls">
                    <button v-for="c in detectedCalls" :key="c.start" class="chip callchip" @click="useCall(c)">
                      <Icon name="phone" :size="12" />{{ c.app }} {{ formatHM(c.start) }}–{{ formatHM(c.end) }}
                    </button>
                  </span>
                </Transition>
              </div>
            </div>
          </Transition>

          <!-- day list: entries + app tracking -->
          <div class="divider"></div>
          <div class="list">
            <nav class="ltabs">
              <button class="fold" :title="listOpen ? 'Свернуть' : 'Развернуть'" @click="toggleList">
                <Icon :name="listOpen ? 'chevronDown' : 'chevronRight'" :size="13" />
              </button>
              <button :class="{ on: listTab === 'entries' }" @click="openList('entries')">
                Записи <span class="cnt">{{ dayEntries.length }}</span>
              </button>
              <button :class="{ on: listTab === 'apps' }" @click="openList('apps')">Приложения</button>
              <span class="spacer"></span>
              <span class="muted small">{{ listTab === 'apps' ? appsRangeLabel : `размечено ${formatDuration(labelledMs)}` }}</span>
            </nav>
            <div v-if="listOpen" class="lbody">
              <template v-if="listTab === 'entries'">
                <template v-for="r in listRows" :key="r.type === 'entry' ? r.e.id : `n${r.n.id}`">
                  <div
                    v-if="r.type === 'entry'"
                    class="lrow"
                    :class="{ sel: r.e.id === entryId, linked: !!linksOf({ type: 'entry', id: r.e.id }).length }"
                    @click="clickEntry(r.e)"
                    @contextmenu.prevent="openEntryMenu($event, r.e)"
                  >
                    <span class="kic sm" :style="{ background: kindColor(r.e.kind) }"><Icon :name="kindIcon(r.e.kind)" :size="11" :stroke="2.2" /></span>
                    <span class="ltime">{{ formatHM(r.e.start) }}–{{ formatHM(r.e.end) }}</span>
                    <span class="llabel">{{ r.e.label }}</span>
                    <span v-if="notesOf(r.e.id).length" class="nbadge" :title="`Заметок к блоку: ${notesOf(r.e.id).length}`"><Icon name="note" :size="10" :stroke="2.4" />{{ notesOf(r.e.id).length }}</span>
                    <span class="ldur">{{ formatDuration(r.e.end - r.e.start) }}</span>
                  </div>
                  <div
                    v-else
                    class="lrow nrow"
                    :class="{ owned: r.owned, sel: panelNote?.id === r.n.id }"
                    :title="r.owned ? 'Заметка к блоку выше' : 'Заметка вне блоков'"
                    @click="openPanelNote(r.n)"
                  >
                    <span class="nic"><Icon :name="noteIcon(r.n)" :size="11" :stroke="2.4" /></span>
                    <span class="ltime">{{ formatHM(r.n.at) }}</span>
                    <span class="llabel ntxt">{{ r.n.text || r.n.transcript || (r.n.audio ? (r.n.audio.kind === 'call' ? 'Запись звонка' : 'Голосовая заметка') : '') }}</span>
                  </div>
                </template>
                <p v-if="!dayEntries.length" class="muted empty">Пока ничего не размечено.</p>
              </template>
              <template v-else>
                <div v-for="a in appsBreakdown.apps.slice(0, 10)" :key="a.app" class="arow">
                  <span class="aname">{{ a.app }}</span>
                  <span class="abar"><span :style="{ width: `${(a.ms / appsTotal) * 100}%`, background: APP_COLORS[a.kind] }"></span></span>
                  <span class="ldur">{{ formatDuration(a.ms) }}</span>
                </div>
                <p v-if="!appsBreakdown.apps.length" class="muted empty">Нет данных об активности.</p>
              </template>
            </div>
          </div>

          <KindMenu
            v-if="menu"
            :x="menu.x"
            :y="menu.y"
            :title="menu.title"
            :current="menu.multi ? undefined : menu.entryId ? data.entries.find((e) => e.id === menu!.entryId)?.kind : kind"
            :bounds="menuBounds"
            :no-kinds="!!menu.planId"
            @pick="onMenuPick"
            @close="menu = undefined"
          >
            <template v-if="menu.planId">
              <button class="mact" :disabled="planDoneIds.has(menu.planId)" @click="planMenu('done')"><Icon name="check" :size="14" />{{ planDoneIds.has(menu.planId) ? 'Уже сделано по плану' : 'Сделано по плану' }}</button>
              <button class="mdel" @click="planMenu('delete')"><Icon name="trash" :size="14" />Удалить из плана</button>
            </template>
            <template v-else-if="menu.multi">
              <div class="msep"></div>
              <button class="mact" @click="mergeSelected"><Icon name="layers" :size="14" />Объединить</button>
              <button class="mdel" @click="deleteFromMenu"><Icon name="trash" :size="14" />Удалить выбранные</button>
            </template>
            <template v-else-if="menu.entryId">
              <div class="msep"></div>
              <button class="mdel" @click="deleteFromMenu"><Icon name="trash" :size="14" />Удалить отрезок</button>
            </template>
          </KindMenu>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  pointer-events: none;
}
.stage.up {
  align-items: flex-end;
}
/* ---------- stuck to a screen edge: flush with it, no rounding on that side ---------- */
.stage.dock-left {
  justify-content: flex-start;
  align-items: flex-start;
}
.stage.dock-right {
  justify-content: flex-end;
  align-items: flex-start;
}
.stage.dock-top .shell {
  border-top-width: 0;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.stage.dock-bottom .shell {
  border-bottom-width: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.stage.dock-left .shell {
  border-left-width: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
.stage.dock-right .shell {
  border-right-width: 0;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.stage[class*='dock-'] .shell:not(.expanded) {
  border-radius: 14px;
}
.stage.dock-top .shell:not(.expanded) {
  border-radius: 0 0 14px 14px;
}
.stage.dock-bottom .shell:not(.expanded) {
  border-radius: 14px 14px 0 0;
}
.stage.dock-left .shell:not(.expanded) {
  border-radius: 0 14px 14px 0;
}
.stage.dock-right .shell:not(.expanded) {
  border-radius: 14px 0 0 14px;
}
/* the slim pill: the move handle, the status and the day's time — nothing else */
.pill.docked {
  inset: 0;
  gap: 6px;
  padding: 0 12px 0 4px;
}
.pill.docked .chips,
.pill.docked .pstats,
.pill.docked .papp,
.pill.docked .pcombo,
.pill.docked .pstatus,
.pill.docked .pday,
.pill.docked .pmarker {
  display: none;
}
.pill.docked .pwave {
  width: 64px;
  height: 18px;
  flex: none;
}
/* at a side edge the wave runs along the edge too: a 64×18 wave turned a quarter (its box made 18×64 by margins) */
.stage.dock-left .pill.docked .pwave,
.stage.dock-right .pill.docked .pwave {
  writing-mode: horizontal-tb;
  width: 64px;
  height: 18px;
  margin: 23px -23px;
}
.stage.dock-right .pill.docked .pwave {
  transform: rotate(90deg);
}
.stage.dock-left .pill.docked .pwave {
  transform: rotate(-90deg);
}
.pill.docked .orb-btn {
  flex: none;
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
}
.pnext {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #93c5fd;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pill.docked .pinfo {
  display: flex;
  align-items: center;
}
.pill.docked .pline {
  flex: 1;
}
.pill.docked .handle {
  width: 26px;
  height: 26px;
}
/* at a side edge it stands upright: text along the edge (layout, not a transform — the drag region follows) */
.stage.dock-left .pill.docked {
  writing-mode: sideways-lr;
  padding: 4px 0 12px;
}
.stage.dock-right .pill.docked {
  writing-mode: vertical-rl;
  padding: 4px 0 12px;
}
.shell {
  position: relative;
  pointer-events: auto;
  background: rgba(17, 19, 26, var(--bga, 1));
  border: 1px solid rgba(255, 255, 255, calc(0.09 * var(--bga, 1)));
  border-radius: 23px;
  overflow: hidden;
  color: var(--text);
  transition:
    width 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    background-color 0.25s ease;
  will-change: width, height;
}
.shell.expanded {
  border-radius: 18px;
}

/* native window dragging */
.drag {
  -webkit-app-region: drag;
}
.nodrag,
.drag button {
  -webkit-app-region: no-drag;
}

/* content cross-fade */
.ifade-enter-active {
  transition:
    opacity 0.22s ease 0.12s,
    transform 0.3s cubic-bezier(0.32, 0.72, 0, 1) 0.08s;
}
.ifade-leave-active {
  transition: opacity 0.12s ease;
}
.ifade-enter-from {
  opacity: 0;
  transform: scale(0.98);
}
.ifade-leave-to {
  opacity: 0;
}

/* ---------- move handle ---------- */
.dragzone {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 6px;
}
.handle {
  cursor: move;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: #6b7280;
  background: rgba(255, 255, 255, 0.04);
}

/* ---------- pill ---------- */
.pill {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 70px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 7px;
  cursor: pointer;
}
.pinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 14px;
  white-space: nowrap;
  overflow: hidden;
}
.pstatus {
  font-weight: 600;
}
.pstatus.work {
  color: #4ade80;
}
.pstatus.idle {
  color: #94a3b8;
}
.pstatus.call {
  color: #5eead4;
}
.papp {
  flex: none;
  max-width: 150px;
  color: #cbd5e1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pmarker {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(165, 180, 252, 0.18);
  color: #c7d2fe;
  font-size: 11px;
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  transition: background 0.3s;
}
.dot.idle {
  background: #6b7280;
}
.dot.call {
  background: #14b8a6;
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    box-shadow: 0 0 0 4px rgba(20, 184, 166, 0.22);
  }
}
.mini {
  position: relative;
  height: 22px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.04);
  overflow: hidden;
}
.mini > div {
  position: absolute;
  top: 0;
  bottom: 0;
}
.m-work {
  background: rgba(99, 102, 241, 0.16);
}
.m-lunch {
  background: rgba(249, 115, 22, 0.28);
}
.m-off {
  background: rgba(0, 0, 0, 0.45);
}
.m-seg {
  bottom: auto !important;
  height: 10px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  overflow: hidden;
}
.m-seg.low {
  top: 12px !important;
}
.m-marker {
  background: rgba(165, 180, 252, 0.3);
  box-shadow: inset 0 0 0 1px #a5b4fc;
}
.m-now {
  width: 2px;
  background: #ef4444;
}
.m-uncut,
.uncut {
  background: repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.45) 0 5px, rgba(148, 163, 184, 0.14) 5px 10px);
  background-size: 14px 14px;
  animation: flow 1.4s linear infinite;
}
@keyframes flow {
  to {
    background-position: 14px 0;
  }
}
.stage.up .pill {
  top: auto;
  bottom: 0;
}
.d-links {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin-top: 4px;
}
.lchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  padding: 2px 8px 2px 3px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.lchip:hover {
  border-color: rgba(167, 139, 250, 0.6);
}
.lic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  color: #fff;
}
.pfill {
  flex: 1;
}
.pwave {
  /* only the room that is left — never squeezes the app name */
  flex: 1 1 0;
  width: 0;
  min-width: 40px;
  height: 14px;
}
.hwave {
  flex: 1 1 0;
  width: 0;
  min-width: 60px;
  height: 18px;
  margin: 0 8px;
}
.nbadge {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
  font-size: 10px;
  font-weight: 700;
}
.nrow .nic {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: #fbbf24;
  color: #1c1917;
}
.nrow.owned {
  margin-left: 22px;
  border-left: 2px solid rgba(251, 191, 36, 0.4);
}
.nrow .ntxt {
  color: #fde68a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pend {
  /* pushed to the right edge by the growing wave (an auto margin would take the room first) */
  margin-left: 0;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pcombo {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 50px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.pcombo.live {
  color: #e2e8f0;
}
.cwrap {
  display: inline-block;
  transform-origin: 0 60%;
  transition: transform 0.15s ease-out;
}
.cnum {
  display: inline-block;
  min-width: 22px;
  font-weight: 800;
  animation: comboShake 0.22s ease-out;
}
@keyframes comboShake {
  0% {
    transform: translate(0, 0) scale(1.08);
  }
  25% {
    transform: translate(var(--amp), calc(var(--amp) * -0.5)) rotate(-1.5deg);
  }
  50% {
    transform: translate(calc(var(--amp) * -1), calc(var(--amp) * 0.5)) rotate(1deg);
  }
  75% {
    transform: translate(calc(var(--amp) * 0.4), 0);
  }
  100% {
    transform: none;
  }
}
.cbest {
  font-weight: 700;
}
.pstats {
  display: flex;
  align-items: center;
  gap: 10px;
  width: max-content;
  max-width: 100%;
  height: 13px;
  overflow: hidden;
  font-size: 10px;
  line-height: 13px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pstats .st {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.pstats .stripe {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.7) 0 2px, transparent 2px 4px);
}
.pstats .jt,
.totals .jt {
  color: #93c5fd;
}
.pstats .pct {
  color: #bbf7d0;
  font-weight: 700;
}
.totals b {
  color: var(--text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.totals .pct b {
  color: #bbf7d0;
}
.ptime {
  font-size: 11px;
  color: #bbf7d0;
  font-variant-numeric: tabular-nums;
}
.orb-btn {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s;
}
.orb-btn:hover,
.orb-btn.on {
  background: rgba(255, 255, 255, 0.06);
}
.pnote {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 100%;
  height: 128px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: auto;
  animation: nslide 0.3s cubic-bezier(0.32, 0.72, 0, 1) 0.05s both;
}
.stage.up .pnote {
  top: auto;
  bottom: 100%;
  padding-top: 6px;
}
@keyframes nslide {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
}
.nhead {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #fde68a;
  white-space: nowrap;
  overflow: hidden;
}
.nhead .muted {
  font-size: 10px;
}
.ntarget {
  color: #e2e8f0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ntext {
  flex: 1;
  resize: none;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(253, 230, 138, 0.25);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.4;
  outline: none;
}
.ntext:focus {
  border-color: rgba(253, 230, 138, 0.55);
}
.notepin.on {
  outline: 2px solid #fff;
}
.qtabs {
  flex: none;
  display: inline-flex;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  overflow: hidden;
}
.qtabs button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.qtabs button.on {
  background: rgba(253, 230, 138, 0.16);
  color: #fde68a;
}
.qtabs button.hot:not(.on) {
  color: #5eead4;
}
.qmsg {
  min-width: 0;
  color: #86efac;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qrow {
  flex: 1;
  display: flex;
  gap: 8px;
  min-height: 0;
}
.qbtn {
  flex: none;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 8px;
  font-size: 12px;
}
.qbtn.ok {
  color: #4ade80;
}
.qside {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.qside .qbtn {
  align-self: stretch;
}
.qnl :deep(.chip) {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  justify-content: flex-start;
  gap: 5px;
  font-size: 12px;
}
.qtop {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qoff {
  flex: none;
}
.qrec {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}
.recbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.12);
  color: #fca5a5;
}
.recbtn.on {
  background: #ef4444;
  color: #fff;
  animation: recpulse 1.2s ease-in-out infinite;
}
@keyframes recpulse {
  50% {
    box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.25);
  }
}
.meter {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.meter span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #facc15, #ef4444);
  transition: width 0.1s;
}
.rt {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.qlp :deep(.chip) {
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
}
.qev {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.qkinds,
.qranges {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  overflow: hidden;
}
.qkinds button,
.qranges button {
  padding: 3px 9px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
}
.qkinds button.on {
  color: #fff;
}
.qranges button.on {
  background: rgba(99, 102, 241, 0.3);
  color: var(--text);
}
.qlabel {
  flex: 1;
  resize: none;
  line-height: 1.4;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.orb-btn.rec::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ef4444;
  box-shadow: 0 0 0 2px #11131a;
  animation: recpulse 1.2s ease-in-out infinite;
}
/* under a fanned-out group of notes: the pointer may cross it without the group folding back */
.fanzone {
  position: absolute;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.08);
  cursor: default;
}
.notepin {
  position: absolute;
  top: 0;
  z-index: 7;
  transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  border-radius: 4px;
  background: #fbbf24;
  color: #1c1917;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.chips {
  display: flex;
  gap: 4px;
  height: 20px;
  width: max-content;
  max-width: 100%;
  overflow: hidden;
}
.pchip.pplan {
  background: transparent;
  border: 1px dashed var(--c);
  color: var(--c);
}
.planseg {
  border: 1px dashed var(--c);
  border-radius: 7px;
  background: color-mix(in srgb, var(--c) 12%, transparent);
  pointer-events: none;
}
.pchip {
  flex: none;
  padding: 0 7px;
  white-space: nowrap;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 6px;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.tkey {
  font-weight: 800;
  margin-right: 2px;
}
.ckey {
  font-weight: 800;
  opacity: 0.95;
}
.editrow {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.d-task {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 4px;
  font-size: 12px;
  color: #bfdbfe;
}
.d-task b {
  color: #93c5fd;
}
.d-desc {
  margin: -2px 0 6px;
  font-size: 12px;
  line-height: 1.45;
  color: #cbd5e1;
  white-space: pre-wrap;
  max-height: 72px;
  overflow: auto;
}
.linkbtn {
  border: 0;
  background: transparent;
  color: #a5b4fc;
  font-size: 12px;
  padding: 2px 4px;
  cursor: pointer;
}
.linkbtn:hover {
  text-decoration: underline;
}
.pchip.gap {
  color: #cbd5e1;
  background: repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.35) 0 5px, rgba(148, 163, 184, 0.12) 5px 10px);
}
.pnotechip {
  padding: 0 5px;
  background: #fbbf24;
  color: #1c1917;
}
.pchip.live {
  color: #e2e8f0;
  background: repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.45) 0 5px, rgba(148, 163, 184, 0.15) 5px 10px);
  background-size: 14px 14px;
  animation: flow 1.4s linear infinite;
}
.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fbbf24;
  animation: blink 1.2s ease-in-out infinite;
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.pday {
  margin-left: 6px;
  color: var(--muted);
  font-size: 11px;
}
.daybar {
  position: absolute;
  left: 14px;
  right: 62px;
  bottom: 3px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.daybar span {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  transition: width 0.6s ease;
}
.daybar .elapsed {
  background: rgba(148, 163, 184, 0.35);
}
.daybar .done {
  background: linear-gradient(90deg, #22c55e, #a3e635);
  box-shadow: 0 0 6px rgba(163, 230, 53, 0.6);
}
.pempty {
  font-size: 11px;
  line-height: 20px;
}

/* ---------- panel ---------- */
.panel {
  position: absolute;
  top: 0;
  left: 0;
  width: 750px;
  padding: 0 16px 14px;
  display: flex;
  flex-direction: column;
}
.head {
  position: relative;
  z-index: 20;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 -16px;
  padding: 7px 12px 4px 7px;
}
.logo {
  color: #7c6cf6;
}
.small {
  font-size: 11px;
}
.spacer {
  flex: 1;
}
.total {
  font-variant-numeric: tabular-nums;
  color: #cbd5e1;
}
.status {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  transition:
    background 0.3s,
    color 0.3s;
}
.status.work {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}
.status.idle {
  background: rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
}
.status.call {
  background: rgba(20, 184, 166, 0.18);
  color: #5eead4;
}
button.icon {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: 0;
  padding: 4px 5px;
  color: #94a3b8;
}
button.icon:hover {
  color: #fff;
}
button.icon.on {
  color: #a5b4fc;
}
.axis {
  position: relative;
  height: 18px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
  cursor: pointer;
}
.axis span {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.axis .sch {
  color: #a5b4fc;
}
.axis .lunch {
  color: #fdba74;
}
.axis .tk {
  position: absolute;
  bottom: -1px;
  width: 1px;
  height: 6px;
  background: rgba(255, 255, 255, 0.45);
}
.axis .tk.minor {
  height: 4px;
  background: rgba(255, 255, 255, 0.28);
}
.total small {
  color: var(--muted);
  font-size: 10px;
}
.axis .nowlbl {
  color: #fca5a5;
  font-weight: 600;
  background: rgba(17, 19, 26, 0.95);
  padding: 0 4px;
  z-index: 1;
}
.track {
  position: relative;
  cursor: crosshair;
  user-select: none;
}
.track > .off,
.track > .sch-work,
.track > .sch-lunch {
  position: absolute;
  top: -3px;
  bottom: -3px;
}
.sch-work {
  background: rgba(99, 102, 241, 0.1);
  border-left: 2px solid rgba(165, 180, 252, 0.7);
  border-right: 2px solid rgba(165, 180, 252, 0.7);
}
.track > .sch-off {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.25);
}
.sch-lunch {
  background: repeating-linear-gradient(135deg, rgba(249, 115, 22, 0.16) 0 5px, rgba(249, 115, 22, 0.06) 5px 10px);
  border-left: 1px dashed rgba(253, 186, 116, 0.6);
  border-right: 1px dashed rgba(253, 186, 116, 0.6);
}
.track > .off {
  top: 0;
  bottom: 0;
  border-radius: 6px;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0 5px, rgba(0, 0, 0, 0.15) 5px 10px);
}
.row-main,
.row-apps {
  position: relative;
}
.row-scroll {
  position: relative;
  overflow-y: auto;
  overflow-x: hidden;
  transition: height 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
.row-scroll::-webkit-scrollbar {
  width: 4px;
}
.row-main {
  position: relative;
}
.lane-bg {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.025);
  pointer-events: none;
}
.fold {
  padding: 3px 4px !important;
}
.row-apps {
  height: 12px;
  margin-top: 4px;
}
.row-main > *,
.row-apps > * {
  position: absolute;
  top: 0;
  bottom: 0;
}
.seg {
  border-radius: 7px;
  background: var(--c);
  color: #fff;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  cursor: pointer;
  transition:
    filter 0.15s,
    box-shadow 0.15s;
}
.sic {
  margin-left: 6px;
}
.stxt {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 6px;
}
.seg:hover {
  filter: brightness(1.15);
}
.seg {
  cursor: grab;
}
.seg.moving {
  cursor: grabbing;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
  z-index: 3;
}
.seg.multi {
  box-shadow:
    0 0 0 2px #fbbf24,
    0 0 10px rgba(251, 191, 36, 0.35);
}
.pinline {
  position: absolute;
  top: -18px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: #fff;
  border-radius: 1px;
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
}
.pinline span {
  pointer-events: auto;
  cursor: ew-resize;
  position: absolute;
  top: -4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.seg.sel {
  box-shadow: 0 0 0 2px #fff;
  z-index: 2;
}
.rh {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 2;
}
.rh.l {
  left: 0;
}
.rh.r {
  right: 0;
}
.seg:hover .rh {
  background: rgba(255, 255, 255, 0.4);
}
.uncut {
  border-radius: 7px;
}
.aseg {
  border-radius: 2px;
  opacity: 0.8;
  transition:
    opacity 0.12s,
    box-shadow 0.12s;
}
.aseg:hover {
  opacity: 1;
  box-shadow:
    0 0 0 1px #fff,
    0 0 8px rgba(255, 255, 255, 0.35);
  z-index: 2;
}
.aseg.idle,
.aseg.locked {
  background: repeating-linear-gradient(90deg, #3f3f46 0 2px, transparent 2px 4px);
}
.band {
  position: absolute;
  top: -3px;
  bottom: -3px;
  border: 2px solid #a5b4fc;
  border-radius: 9px;
  background: rgba(165, 180, 252, 0.14);
  pointer-events: none;
  z-index: 3;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.cap {
  position: absolute;
  top: -21px;
  padding: 1px 6px;
  border-radius: 6px;
  background: #e0e7ff;
  color: #111827;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: auto;
  cursor: ew-resize;
  z-index: 6;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.cap.l {
  right: 100%;
  margin-right: -10px;
}
.cap.r {
  left: 100%;
  margin-left: -10px;
}
.h {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 10px;
  border-radius: 4px;
  background: #e0e7ff;
  pointer-events: auto;
  cursor: ew-resize;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}
.h.l {
  left: -6px;
}
.h.r {
  right: -6px;
}
.hid {
  position: absolute;
  top: 6px;
  z-index: 7;
  padding: 2px 7px;
  border-radius: 999px;
  border: 0;
  background: rgba(99, 102, 241, 0.9);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.hid:hover {
  background: #575bf0;
}
.hid.l {
  left: 2px;
}
.hid.r {
  right: 2px;
}
.nowline {
  position: absolute;
  top: -4px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: #ef4444;
  pointer-events: none;
  z-index: 4;
}
.legend {
  height: 20px;
  margin-top: 6px;
  font-size: 12px;
  overflow: hidden;
}
.legend .items {
  display: flex;
  gap: 12px;
  align-items: center;
  white-space: nowrap;
}
.legend .items > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend .hover {
  display: block;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
i.sq {
  border-radius: 2px;
}
i.sq.work {
  background: rgba(99, 102, 241, 0.35);
  box-shadow: inset 0 0 0 1px #a5b4fc;
}
i.sq.lunch {
  background: rgba(249, 115, 22, 0.4);
  box-shadow: inset 0 0 0 1px #fdba74;
}
.striped {
  border-radius: 2px;
  background: repeating-linear-gradient(135deg, #94a3b8 0 2px, transparent 2px 4px);
}
.divider {
  height: 1px;
  margin: 8px -16px 12px;
  background: rgba(255, 255, 255, 0.07);
}
.details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.d-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
}
.kic {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #fff;
}
.d-sub {
  color: #cbd5e1;
  font-size: 13px;
}
.times {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  font-size: 13px;
}
.dur {
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.seg2 {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  margin-left: 4px;
}
.seg2 button {
  border: 0;
  border-radius: 0;
  padding: 3px 8px;
  font-size: 11px;
  background: transparent;
}
.seg2 button.on {
  background: var(--accent);
  color: #fff;
}
.inputrow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.inputrow .dialoff {
  flex: none;
  height: 44px;
  border-radius: 10px;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.apply {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  border-radius: 10px;
  background: #16a34a;
  border: 1px solid #16a34a;
  color: #fff;
}
.apply:hover:not(:disabled) {
  background: #15803d;
}
.kseg {
  flex: 1;
  min-width: 0;
  display: flex;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  overflow: hidden;
}
.kseg button {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 6px 4px 5px;
  border: 0;
  border-radius: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  font-size: 11px;
  color: #cbd5e1;
}
.kseg button:first-child {
  border-left: 0;
}
.kseg button span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kseg button:hover {
  background: rgba(255, 255, 255, 0.07);
}
.kseg button.on {
  color: #fff;
}
.mini-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mini-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 7px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.mini-actions button:hover {
  background: rgba(255, 255, 255, 0.09);
}
.mini-actions button.danger {
  color: #fca5a5;
}
.editbox {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cancel {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.actions4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.actions4 > button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px 7px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
}
.actions4 > button.danger {
  color: #fca5a5;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ltabs {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ltabs button {
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 7px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted);
}
.ltabs button.on {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: var(--text);
}
.cnt {
  margin-left: 3px;
  font-size: 10px;
  opacity: 0.7;
}
.lbody {
  max-height: 168px;
  overflow-y: auto;
  margin-right: -6px;
  padding-right: 4px;
}
.lrow,
.trow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 12px;
}
.lrow {
  cursor: pointer;
}
.lrow:hover {
  background: rgba(255, 255, 255, 0.05);
}
.lrow.sel {
  background: rgba(99, 102, 241, 0.18);
}
.kic.sm {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  flex: none;
}
.ltime,
.ldur {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.ltime {
  color: #cbd5e1;
}
.ldur {
  margin-left: auto;
  color: var(--muted);
}
.llabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lkey {
  flex: none;
  color: #93c5fd;
  font-weight: 600;
  font-size: 11px;
}
.arow {
  display: grid;
  grid-template-columns: 130px 1fr 60px;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  font-size: 12px;
}
.aname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abar {
  height: 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.abar span {
  display: block;
  height: 100%;
  border-radius: 4px;
}
.arow .ldur {
  text-align: right;
}
.empty {
  margin: 6px;
  font-size: 12px;
}
.msep {
  height: 1px;
  margin: 4px;
  background: var(--border);
}
.mact {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.mact:hover {
  background: var(--hover);
}
.mdel {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: #fca5a5;
}
.mdel:hover {
  background: rgba(239, 68, 68, 0.15);
}
.foot {
  min-height: 22px;
  font-size: 12px;
}
.calls {
  display: flex;
  gap: 6px;
}
.callchip {
  border-color: #14b8a6;
  color: #5eead4;
}
.toast {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #86efac;
}
.toast.bad {
  color: #fca5a5;
}
</style>
