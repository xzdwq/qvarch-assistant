<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { LinkStyle } from '@shared/linkpath'
import { linkedTo } from '@shared/links'
import { isProductive } from '@shared/kinds'
import { visibleNotes } from '@shared/notes'
import { clipEntries, dayEnd, dayStart, formatDuration, formatHM, HOUR, MINUTE, unionMs } from '@shared/timeline'
import type { DayData, Entry, Link, LinkEnd } from '@shared/types'
import { OWN_PREFIX } from '@shared/board'
import { entryIcon, kindColor, kindLabel, kinds } from '../lib/palette'
import { useJira } from '../lib/jira'
import { useLocalTasks } from '../lib/tasks'
import Icon from './Icon.vue'
import { todayKey } from '../lib/today'
import LinkLayer from './LinkLayer.vue'
import EntryEditor, { type Draft } from './EntryEditor.vue'
import NoteEditor from './NoteEditor.vue'
import { clusterize, useFan } from '../lib/pinfan'
import { placeFloat } from '../lib/floating'
import KindMenu from './KindMenu.vue'
import { askSeries } from '../lib/seriesAsk'

/**
 * The work as a calendar: an endless strip of days (past and future — Outlook meetings live there), hours
 * top to bottom at a readable height. Everything the timeline does is here too: drag down on a day to add
 * an event, drag an event to another time or day, pull its edge to resize, click to edit / delete in the
 * side panel (the same editor as the main window), notes with voice / call audio, links — also across days.
 * Wheel — hours; Shift + wheel, a wheel over the dates or a sideways drag — days; Ctrl + wheel — zoom.
 */
const props = defineProps<{ linkStyle: LinkStyle; workDays?: number[] }>()
const emit = defineEmits<{ openDay: [day: string] }>()
const jira = useJira()
const own = useLocalTasks()

// ---------- days as numbers ----------
const DAY_MS = 86_400_000
const toNum = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS)
const toKey = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const today = todayKey
const todayNum = computed(() => toNum(today.value))
const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay()
const isOff = (n: number) => !(props.workDays ?? [1, 2, 3, 4, 5]).includes(weekday(n))
const nowMs = ref(Date.now())

// ---------- viewport: `span` days in view, starting at day `start` (fractional) ----------
const MIN_SPAN = 1
const MAX_SPAN = 366
const ZY_MIN = 0.15
const ZY_MAX = 12
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('qa.tcal2') ?? '{}') as { span?: number; productive?: boolean; links?: boolean; zy?: number }
  } catch {
    return {}
  }
})()
const span = ref(Math.min(MAX_SPAN, Math.max(MIN_SPAN, saved.span ?? 7)))
const leadOf = (s: number) => (s <= 1.5 ? 0 : s <= 8 ? Math.min(1, s * 0.15) : s * 0.2)
const start = ref(todayNum.value - leadOf(span.value))
const onlyProductive = ref(saved.productive ?? false)
const showLinks = ref(saved.links ?? true)
/** The vertical scale (the time step): the wheel over the hours changes it. */
const zy = ref(Math.min(ZY_MAX, Math.max(ZY_MIN, saved.zy ?? 1)))
const q = ref('')
watch([span, onlyProductive, showLinks, zy], () => {
  try {
    localStorage.setItem('qa.tcal2', JSON.stringify({ span: Math.round(span.value * 100) / 100, productive: onlyProductive.value, links: showLinks.value, zy: Math.round(zy.value * 1000) / 1000 }))
  } catch {
    // not remembered — fine
  }
})

const canvas = ref<HTMLElement>()
const body = ref<HTMLElement>()
const head = ref<HTMLElement>()
const W = ref(1000)
const H = ref(600)
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(() => {
    if (canvas.value) W.value = canvas.value.clientWidth
    if (body.value) H.value = body.value.clientHeight
  })
  if (canvas.value) ro.observe(canvas.value)
  if (body.value) ro.observe(body.value)
  // the working morning in view, like a calendar opens
  requestAnimationFrame(() => body.value && (body.value.scrollTop = 7 * hourPx.value - 6))
})
onBeforeUnmount(() => ro?.disconnect())
/** The width of one day at this zoom; a day with parallel events is wider (see widthOf). */
const colW = computed(() => W.value / span.value)
const firstDay = computed(() => Math.floor(start.value))
const lastDay = computed(() => Math.ceil(start.value + span.value))
const visibleNums = computed(() => Array.from({ length: lastDay.value - firstDay.value + 1 }, (_, i) => firstDay.value + i))
/** Day / week zoom: days are cards with gaps between them (the link lines run there). */
const roomy = computed(() => colW.value >= 90)
const GUT = computed(() => (roomy.value ? 8 : colW.value > 12 ? 1 : 0))
/** The events of each visible day laid out in columns (computed once per change). */
const layouts = computed(() => {
  const m = new Map<number, Array<{ e: Entry; col: number; cols: number }>>()
  for (const n of visibleNums.value) m.set(n, layoutDay(shownEntries(toKey(n))))
  return m
})
/** A day with parallel events gets wider (up to 3×) so each stays readable — at the day / week zoom. */
const factorOf = (n: number) => (roomy.value ? Math.min(3, Math.max(1, ...(layouts.value.get(n) ?? []).map((x) => x.cols))) : 1)
const widthOf = (n: number) => colW.value * factorOf(n)
/** Extra width of the widened days before each visible day. */
const extra = computed(() => {
  const m = new Map<number, number>()
  let acc = 0
  for (const n of visibleNums.value) {
    m.set(n, acc)
    acc += (factorOf(n) - 1) * colW.value
  }
  m.set(lastDay.value + 1, acc)
  return m
})
const xOf = (n: number) => (n - start.value) * colW.value + (n < firstDay.value ? 0 : (extra.value.get(Math.min(n, lastDay.value + 1)) ?? 0))

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'День', days: 1 },
  { label: 'Неделя', days: 7 },
  { label: 'Месяц', days: 31 },
  { label: 'Квартал', days: 92 },
  { label: 'Год', days: 365 },
]
function zoomTo(days: number): void {
  const centre = todayNum.value >= start.value && todayNum.value <= start.value + span.value ? todayNum.value + 0.5 : start.value + span.value / 2
  const frac = (centre - start.value) / span.value
  span.value = days
  start.value = days <= 1 ? Math.floor(centre) : centre - frac * days
}
function goToday(): void {
  start.value = todayNum.value - leadOf(span.value)
}
const nearPreset = computed(() => PRESETS.reduce((a, b) => (Math.abs(Math.log(b.days / span.value)) < Math.abs(Math.log(a.days / span.value)) ? b : a)).days)

// wheel: the hours scroll (natively); Shift / a horizontal wheel: the days; Ctrl: zoom around the pointer
function onWheel(e: WheelEvent): void {
  if (!e.ctrlKey && !e.shiftKey && (e.target as HTMLElement).closest('.hours')) return zoomHours(e)
  const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
  if (!e.ctrlKey && !horizontal) return
  e.preventDefault()
  const r = canvas.value!.getBoundingClientRect()
  if (e.ctrlKey) {
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const at = start.value + fx * span.value
    const next = Math.min(MAX_SPAN, Math.max(MIN_SPAN, span.value * Math.exp(e.deltaY * 0.0016)))
    span.value = next
    start.value = at - fx * next
    return
  }
  start.value += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / colW.value
}
/** Where the hours should be scrolled once the new scale is drawn (several wheel steps may come first). */
let wantTop: number | undefined
function zoomHours(e: WheelEvent): void {
  e.preventDefault()
  const b = body.value
  if (!b || !e.deltaY) return
  // not in the middle of a drag: its maths uses the scale
  if (g.value && g.value.kind !== 'pending') return
  const py = e.clientY - b.getBoundingClientRect().top
  const top = wantTop ?? b.scrollTop
  const at = (top + py) / hourPx.value // the hour under the pointer stays under it
  const dy = Math.max(-120, Math.min(120, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY))
  zy.value = Math.min(ZY_MAX, Math.max(ZY_MIN, zy.value * Math.exp(-dy * 0.0022)))
  wantTop = Math.max(0, at * hourPx.value - py)
  void nextTick(() => {
    if (wantTop === undefined) return
    b.scrollTop = wantTop
    wantTop = undefined
  })
}
function resetHours(): void {
  zy.value = 1
}
function onHeadWheel(e: WheelEvent): void {
  if (e.ctrlKey) return onWheel(e)
  e.preventDefault()
  start.value += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / colW.value
}
onMounted(() => {
  body.value?.addEventListener('wheel', onWheel, { passive: false })
  head.value?.addEventListener('wheel', onHeadWheel, { passive: false })
})
onBeforeUnmount(() => {
  body.value?.removeEventListener('wheel', onWheel)
  head.value?.removeEventListener('wheel', onHeadWheel)
})

// ---------- data: loaded in chunks around the view ----------
type DayLite = Pick<DayData, 'day' | 'entries' | 'links' | 'notes' | 'spans' | 'plan'>
const days = shallowRef(new Map<string, DayLite>())
const loaded = new Set<number>()
const totals = ref<Record<string, number>>({})
const CHUNK = 30
let loading = false
async function ensure(): Promise<void> {
  if (loading) return
  const want: number[] = []
  for (let c = Math.floor((firstDay.value - CHUNK) / CHUNK); c <= Math.floor((lastDay.value + CHUNK) / CHUNK); c++) if (!loaded.has(c)) want.push(c)
  if (!want.length) return
  loading = true
  try {
    const from = toKey(Math.min(...want) * CHUNK)
    const to = toKey((Math.max(...want) + 1) * CHUNK - 1)
    const list = await window.qa.calendarRange(from, to)
    const m = new Map(days.value)
    for (const [k] of m) if (k >= from && k <= to) m.delete(k)
    for (const d of list) m.set(d.day, d)
    for (const c of want) loaded.add(c)
    days.value = m
  } finally {
    loading = false
  }
  void ensure()
}
async function reloadVisible(): Promise<void> {
  for (let c = Math.floor((firstDay.value - 1) / CHUNK); c <= Math.floor((lastDay.value + 1) / CHUNK); c++) loaded.delete(c)
  await ensure()
  totals.value = await window.qa.jiraTracked()
}
let ensureTimer: ReturnType<typeof setTimeout> | undefined
watch([firstDay, lastDay], () => {
  clearTimeout(ensureTimer)
  ensureTimer = setTimeout(() => void ensure(), 60)
})
void ensure().then(async () => (totals.value = await window.qa.jiraTracked()))
let last = 0
const off = window.qa.onDayState(() => {
  nowMs.value = Date.now()
  // a change elsewhere (island, sync) — but not while the user drags here
  if (Date.now() - last > 15_000 && !g.value) {
    last = Date.now()
    void reloadVisible()
  }
})
onBeforeUnmount(() => {
  off()
  clearTimeout(ensureTimer)
})

const s = computed(() => q.value.trim().toLowerCase())
const visibleEntry = (e: Entry) =>
  (!onlyProductive.value || isProductive(kinds.value, e.kind)) &&
  (!s.value || e.label.toLowerCase().includes(s.value) || (e.task?.key.toLowerCase().includes(s.value) ?? false) || (e.description ?? '').toLowerCase().includes(s.value))
const titleOf = (e: Entry) => {
  const t = e.task && e.task.key.startsWith(OWN_PREFIX) ? own.value.find((x) => x.key === e.task!.key) : undefined
  return (t?.title ?? e.label) || kindLabel(e.kind)
}
const findEntry = (id: string): { e: Entry; day: string } | undefined => {
  for (const [day, d] of days.value) {
    const e = d.entries.find((x) => x.id === id)
    if (e) return { e, day }
  }
  return undefined
}

// ---------- gestures: pan, create, move (also to another day), resize ----------
type Gesture =
  | { kind: 'pending'; x0: number; y0: number; day: number; t0: number; s0: number; pid: number }
  | { kind: 'pan'; x0: number; s0: number }
  | { kind: 'create'; day: number; t0: number; t1: number }
  | { kind: 'move'; id: string; from: string; x0: number; y0: number; orig: Entry; moved: boolean; toDay: number; start: number; dayOff: number }
  | { kind: 'resize'; id: string; day: string; edge: 'start' | 'end'; orig: Entry; moved: boolean; start: number; end: number }
const g = ref<Gesture>()
const SNAP = 5 * MINUTE
const snapT = (t: number) => Math.round(t / SNAP) * SNAP
function dayAt(clientX: number): number {
  const r = canvas.value!.getBoundingClientRect()
  const x = clientX - r.left
  for (const n of visibleNums.value) if (x >= xOf(n) && x < xOf(n) + widthOf(n)) return n
  return Math.floor(start.value + x / colW.value)
}
function timeAt(clientY: number, dayNum: number): number {
  const r = canvas.value!.getBoundingClientRect()
  const d = toKey(dayNum)
  return Math.max(dayStart(d), Math.min(dayEnd(d), snapT(dayStart(d) + ((clientY - r.top) / hourPx.value) * HOUR)))
}
function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const t = e.target as HTMLElement
  if (t.closest('.lk-corner, .unlink, .dlabel, [data-note], .fanzone, .xlink, .hplus, .lbadge')) return
  const evEl = t.closest<HTMLElement>('[data-entry]')
  if (evEl) {
    const f = findEntry(evEl.dataset.entry!)
    if (!f) return
    const r = evEl.getBoundingClientRect()
    const edge = r.height >= 22 ? (e.clientY - r.top < 5 ? 'start' : r.bottom - e.clientY < 5 ? 'end' : undefined) : undefined
    g.value = edge
      ? { kind: 'resize', id: f.e.id, day: f.day, edge, orig: f.e, moved: false, start: f.e.start, end: f.e.end }
      : { kind: 'move', id: f.e.id, from: f.day, x0: e.clientX, y0: e.clientY, orig: f.e, moved: false, toDay: toNum(f.day), start: f.e.start, dayOff: dayAt(e.clientX) - toNum(f.day) }
  } else {
    const day = dayAt(e.clientX)
    g.value = { kind: 'pending', x0: e.clientX, y0: e.clientY, day, t0: timeAt(e.clientY, day), s0: start.value, pid: e.pointerId }
  }
  canvas.value?.setPointerCapture(e.pointerId)
}
/** Where the pointer is over an empty spot: the day and the (snapped) moment — a line + a "+" there. */
const hover = ref<{ n: number; t: number }>()
function onMove(e: PointerEvent): void {
  const x = g.value
  if (!x) {
    // over a note, or between the fanned-out notes: no time line / "+" behind them
    const over = (e.target as HTMLElement).closest('[data-entry], [data-note], .fanzone, .lk-corner, .unlink, .hplus')
    if (over && !(over as HTMLElement).classList.contains('hplus')) hover.value = undefined
    else if (!over) {
      const n = dayAt(e.clientX)
      hover.value = { n, t: timeAt(e.clientY, n) }
    }
    return
  }
  if (x.kind === 'pending') {
    const dx = e.clientX - x.x0
    const dy = e.clientY - x.y0
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    // sideways — the days scroll; down / up — a new event on that day
    g.value = Math.abs(dx) > Math.abs(dy) ? { kind: 'pan', x0: x.x0, s0: x.s0 } : { kind: 'create', day: x.day, t0: x.t0, t1: timeAt(e.clientY, x.day) }
    return
  }
  if (x.kind === 'pan') start.value = x.s0 - (e.clientX - x.x0) / colW.value
  else if (x.kind === 'create') x.t1 = timeAt(e.clientY, x.day)
  else if ((x.kind === 'move' || x.kind === 'resize') && x.orig.outlook) return
  else if (x.kind === 'move') {
    x.moved ||= Math.abs(e.clientX - x.x0) + Math.abs(e.clientY - x.y0) > 5
    if (!x.moved) return
    const dur = x.orig.end - x.orig.start
    x.toDay = dayAt(e.clientX) - x.dayOff
    const d = toKey(x.toDay)
    const shifted = snapT(x.orig.start - dayStart(x.from) + ((e.clientY - x.y0) / hourPx.value) * HOUR)
    x.start = Math.max(dayStart(d), Math.min(dayEnd(d) - dur, dayStart(d) + shifted))
  } else if (x.kind === 'resize') {
    x.moved = true
    const t = timeAt(e.clientY, toNum(x.day))
    if (x.edge === 'start') x.start = Math.min(t, x.end - SNAP)
    else x.end = Math.max(t, x.start + SNAP)
  }
}
async function onUp(): Promise<void> {
  const x = g.value
  g.value = undefined
  if (!x) return
  if (x.kind === 'create') {
    const a = Math.min(x.t0, x.t1)
    const b = Math.max(x.t0, x.t1)
    if (b - a >= SNAP) openDraft(toKey(x.day), a, b)
  } else if (x.kind === 'move') {
    if (!x.moved) return openEntry(x.orig, x.from)
    const to = toKey(x.toDay)
    if (to === x.from && x.start === x.orig.start) return
    try {
      await window.qa.moveEntry(x.from, to, x.id, x.start, x.start + (x.orig.end - x.orig.start))
    } finally {
      await reloadVisible()
      // the open panel follows the moved event (its new day and times)
      const f = selectedId.value === x.id ? findEntry(x.id) : undefined
      if (f) panel.value = { type: 'entry', day: f.day, entry: f.e, key: f.e.id }
    }
  } else if (x.kind === 'resize') {
    if (!x.moved) return openEntry(x.orig, x.day)
    const { followsNow: _f, ...plain } = JSON.parse(JSON.stringify(x.orig)) as Entry & { followsNow?: boolean }
    await window.qa.saveEntry(x.day, { ...plain, start: x.start, end: x.end }, { overlap: true })
    await reloadVisible()
  }
}
// double click on an empty spot: a note at that moment
function onDbl(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('[data-entry], [data-note], .fanzone')) return
  const day = dayAt(e.clientX)
  openNote(toKey(day), { id: crypto.randomUUID(), at: timeAt(e.clientY, day), text: '', isNew: true })
}

/** The day's events as drawn — a dragged / resized one where it is being put. */
const shownEntries = (day: string): Entry[] => {
  const x = g.value
  let list = days.value.get(day)?.entries ?? []
  if (x?.kind === 'move' && x.moved) {
    list = list.filter((e) => e.id !== x.id)
    if (toKey(x.toDay) === day) list = [...list, { ...x.orig, start: x.start, end: x.start + (x.orig.end - x.orig.start) }]
  } else if (x?.kind === 'resize' && x.moved && x.day === day) list = list.map((e) => (e.id === x.id ? { ...e, start: x.start, end: x.end } : e))
  return list.filter(visibleEntry).sort((a, b) => a.start - b.start || (a.lane ?? 0) - (b.lane ?? 0))
}

// ---------- hours: the whole day at a readable height ----------
const MIN_HOUR_PX = 48
/** The whole day in view … ×12 of the usual height. */
const fitPx = computed(() => Math.max(8, (H.value - 2) / 24))
const hourPx = computed(() => Math.max(fitPx.value, Math.min(720, Math.max(MIN_HOUR_PX, H.value / 24) * zy.value)))
/** Finer lines once an hour is tall enough. */
const subMin = computed(() => (hourPx.value >= 260 ? 15 : hourPx.value >= 110 ? 30 : 0))
const subLines = computed(() => {
  const s = subMin.value
  if (!s) return []
  const out: Array<{ y: number; label: string; half: boolean }> = []
  for (let h = 0; h < 24; h++)
    for (let m = s; m < 60; m += s) out.push({ y: (h + m / 60) * hourPx.value, label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, half: m === 30 })
  return out
})
const yOf = (t: number, day: string) => ((t - dayStart(day)) / HOUR) * hourPx.value
const hours = Array.from({ length: 24 }, (_, i) => i)
/** One line of an event's text. */
const LINE = 12.5

/** Events that really overlap in time side by side; back-to-back ones stay one under another. */
function layoutDay(list: Entry[], minMs = 0): Array<{ e: Entry; col: number; cols: number }> {
  const out: Array<{ e: Entry; col: number; cluster: number }> = []
  const clusterCols: number[] = []
  let cluster = -1
  let clusterEnd = -Infinity
  let colEnds: number[] = []
  for (const e of list) {
    const end = Math.max(e.end, e.start + minMs)
    if (e.start >= clusterEnd) {
      cluster++
      colEnds = []
      clusterCols[cluster] = 0
    }
    let col = colEnds.findIndex((x) => x <= e.start)
    if (col < 0) col = colEnds.length
    colEnds[col] = end
    clusterEnd = Math.max(clusterEnd, end)
    clusterCols[cluster] = Math.max(clusterCols[cluster], col + 1)
    out.push({ e, col, cluster })
  }
  return out.map((x) => ({ e: x.e, col: x.col, cols: clusterCols[x.cluster] }))
}
const placed = computed(() => {
  const out: Array<{ e: Entry; day: string; x: number; y: number; w: number; h: number; lines: number; time: boolean; dragging: boolean }> = []
  const gx = g.value
  const dragId = gx && (gx.kind === 'move' || gx.kind === 'resize') && gx.moved ? gx.id : undefined
  for (const n of visibleNums.value) {
    const day = toKey(n)
    const cw = widthOf(n)
    const gut = GUT.value
    const inner = cw - 2 * gut
    const gap = roomy.value ? 4 : cw > 12 ? 2 : 0.5
    for (const { e, col, cols } of layouts.value.get(n) ?? []) {
      const x = xOf(n) + gut + (inner * col) / cols
      const w = Math.max(2, inner / cols - (cols > 1 ? gap : 0))
      // exactly as long as it lasts: the order in time is always seen; text only where it fits (else — the tooltip)
      const h = Math.max(3, ((e.end - e.start) / HOUR) * hourPx.value - 1)
      const time = h >= 2 * LINE + 4
      const lines = Math.max(0, Math.floor((h - 3 - (time ? LINE : 0)) / LINE))
      out.push({ e, day, x, y: yOf(e.start, day), w, h, lines, time, dragging: e.id === dragId })
    }
  }
  return out
})
const allEntries = computed(() => placed.value.map((p) => p.e))
/** How many links each event has (same day and across days). */
const linkCount = computed(() => {
  const m = new Map<string, number>()
  const seen = new Set<string>()
  for (const d of days.value.values())
    for (const l of d.links ?? []) {
      if (seen.has(l.id)) continue
      seen.add(l.id)
      for (const e of [l.a, l.b]) if (e.type === 'entry') m.set(e.id, (m.get(e.id) ?? 0) + 1)
    }
  return m
})
const linesShown = computed(() => showLinks.value && colW.value >= 30)
const notePins = computed(() =>
  colW.value < 24
    ? []
    : visibleNums.value.flatMap((n) => {
        const day = toKey(n)
        // at the right edge of the day — clear of the events' text
        return visibleNotes(days.value.get(day)?.notes).map((note) => ({ note, day, x: xOf(n) + widthOf(n) - 17, y: yOf(note.at, day) }))
      }),
)
const fan = useFan()
/** The area of the open group: the pointer stays "inside" while it moves between the fanned notes. */
const fanZone = computed(() => {
  const k = fan.open.value
  const p = k && notePins.value.find((x) => x.note.id === k)
  const n = k ? (pinPlaces.value.get(k)?.n ?? 1) : 1
  return p && n > 1 ? { left: p.x - (n - 1) * 18 - 5, top: p.y - 12, width: (n - 1) * 18 + 25, height: 25 } : undefined
})
const pinPlaces = computed(() => clusterize(notePins.value.map((p) => ({ ...p, id: p.note.id })), (p) => p.y, 16, (p) => p.day))

/** Links of the days in view; one across days is listed in both — drawn once. */
const allLinks = computed<Link[]>(() => {
  if (!showLinks.value || colW.value < 30) return []
  const seen = new Set<string>()
  const out: Link[] = []
  for (const n of visibleNums.value)
    for (const l of days.value.get(toKey(n))?.links ?? []) {
      if (seen.has(l.id)) continue
      seen.add(l.id)
      out.push(l)
    }
  return out
})

// ---------- headers & footer ----------
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const months = computed(() => {
  const out: Array<{ key: string; x: number; w: number; label: string }> = []
  let n = firstDay.value
  while (n <= lastDay.value) {
    const k = toKey(n)
    const first = toNum(`${k.slice(0, 7)}-01`)
    const y = +k.slice(0, 4)
    const m = +k.slice(5, 7)
    const next = toNum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`)
    const x = Math.max(0, xOf(first))
    out.push({ key: k.slice(0, 7), x, w: Math.min(W.value, xOf(next)) - x, label: `${MONTHS[m - 1]} ${y}` })
    n = next
  }
  return out
})
const dayLabel = (n: number) => {
  const d = +toKey(n).slice(8)
  if (colW.value >= 64) return `${WD[weekday(n)]} ${d}`
  if (colW.value >= 18) return String(d)
  return colW.value >= 7 && weekday(n) === 1 ? String(d) : ''
}
/** Per day: done (what already happened, parallel counted once), of it productive, still planned, events. */
const stats = computed(() =>
  visibleNums.value.map((n) => {
    const day = toKey(n)
    const list = (days.value.get(day)?.entries ?? []).filter(visibleEntry)
    const done = clipEntries(list, nowMs.value)
    return {
      n,
      day,
      done: unionMs(done),
      productive: unionMs(done.filter((e) => isProductive(kinds.value, e.kind))),
      planned: unionMs(list.filter((e) => e.end > nowMs.value).map((e) => ({ start: Math.max(e.start, nowMs.value), end: e.end }))),
      count: list.length,
      plan: unionMs((days.value.get(day)?.plan ?? []).map((p) => ({ start: p.start, end: p.end }))),
      tasks: new Set(list.filter((e) => e.task).map((e) => e.task!.key)).size,
      meetings: list.filter((e) => e.outlook || e.kind === 'meeting' || e.kind === 'call').length,
      notes: visibleNotes(days.value.get(day)?.notes).length,
    }
  }),
)
const nowY = computed(() => yOf(nowMs.value, today.value))
/** Only the first letter up (CSS capitalize would make «2026 Г.»). */
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', o)
const rangeText = computed(() => {
  const a = toKey(Math.floor(start.value + 0.01))
  const b = toKey(Math.ceil(start.value + span.value - 0.01) - 1)
  return a >= b ? fmt(a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : `${fmt(a, { day: 'numeric', month: 'short' })} — ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`
})

// ---------- the side panel: the same editors as the main window ----------
type Panel =
  | { type: 'entry'; day: string; entry: Draft; key: string }
  | { type: 'note'; day: string; note: { id: string; at: number; text: string; taskId?: string; isNew?: boolean } }
const panel = ref<Panel>()
function openEntry(e: Entry, day: string): void {
  panel.value = { type: 'entry', day, entry: e, key: e.id }
}
function openDraft(day: string, a: number, b: number, kind = 'task'): void {
  panel.value = { type: 'entry', day, entry: { start: a, end: b, kind, label: '', source: 'manual' }, key: `new${a}${kind}` }
}

// ---------- the right-click menu: as on the timeline ----------
const cmenu = ref<{ x: number; y: number; day: string; t: number; entry?: Entry }>()
function onContext(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]')
  const n = dayAt(e.clientX)
  const t = timeAt(e.clientY, n)
  const f = el ? findEntry(el.dataset.entry!) : undefined
  cmenu.value = { x: e.clientX, y: e.clientY, day: f?.day ?? toKey(n), t, entry: f?.e }
}
async function onMenuKind(kind: string): Promise<void> {
  const m = cmenu.value
  cmenu.value = undefined
  if (!m) return
  // an empty spot: a new block of that kind there (30 min); a block: its kind changes
  if (!m.entry) return openDraft(m.day, m.t, Math.min(dayEnd(m.day), m.t + 30 * MINUTE), kind)
  const e = m.entry
  if (e.outlook) return
  const label = e.label === kindLabel(e.kind) ? kindLabel(kind) : e.label
  await window.qa.saveEntry(m.day, { ...e, kind, label }, { overlap: true })
  await reloadVisible()
}
function menuOpen(): void {
  const m = cmenu.value
  cmenu.value = undefined
  if (m?.entry) openEntry(m.entry, m.day)
}
function menuNote(): void {
  const m = cmenu.value
  cmenu.value = undefined
  if (m) openNote(m.day, { id: crypto.randomUUID(), at: m.t, text: '', isNew: true })
}
async function menuDelete(): Promise<void> {
  const m = cmenu.value
  cmenu.value = undefined
  const e = m?.entry
  if (!m || !e || e.outlook) return
  if (e.series) {
    const scope = await askSeries('delete')
    if (!scope) return
    if (scope === 'all') await window.qa.seriesDelete(m.day, e.id)
    else await window.qa.deleteEntry(m.day, e.id)
  } else await window.qa.deleteEntry(m.day, e.id)
  if (panel.value?.type === 'entry' && (panel.value.entry as Partial<Entry>).id === e.id) panel.value = undefined
  await reloadVisible()
}
function openNote(day: string, note: { id: string; at: number; text: string; taskId?: string; isNew?: boolean }): void {
  panel.value = { type: 'note', day, note }
}
function addEvent(): void {
  const t = snapT(Date.now())
  openDraft(today.value, t, t + 30 * MINUTE)
}
function addNote(): void {
  openNote(today.value, { id: crypto.randomUUID(), at: Date.now(), text: '', isNew: true })
}
const panelNoteId = computed(() => (panel.value?.type === 'note' ? panel.value.note.id : undefined))
const selectedId = computed(() => (panel.value?.type === 'entry' ? (panel.value.entry as Partial<Entry>).id : undefined))
const panelDay = computed(() => (panel.value ? days.value.get(panel.value.day) : undefined))
const panelEntry = computed(() => {
  const p = panel.value
  return p?.type === 'entry' && 'id' in p.entry && p.entry.id ? (panelDay.value?.entries.find((x) => x.id === (p.entry as Entry).id) ?? (p.entry as Entry)) : undefined
})
/** A new event being set up in the panel: drawn on the calendar (dashed) and kept in view. */
const draft = computed(() => {
  const p = panel.value
  if (p?.type !== 'entry' || (p.entry as Partial<Entry>).id) return undefined
  return { day: p.day, n: toNum(p.day), start: p.entry.start, end: Math.max(p.entry.end, p.entry.start + SNAP) }
})
function onDraftRange(r: { start: number; end: number }): void {
  const p = panel.value
  if (p?.type === 'entry' && !(p.entry as Partial<Entry>).id) panel.value = { ...p, entry: { ...p.entry, start: r.start, end: r.end } }
}
/** The day into view (sideways) and the time (up / down). */
function reveal(day: string, a: number, b: number): void {
  const n = toNum(day)
  if (n < start.value || n + 1 > start.value + span.value) start.value = n - leadOf(span.value)
  void nextTick(() => {
    const el = body.value
    if (!el) return
    const top = yOf(a, day)
    const bottom = yOf(b, day)
    if (top < el.scrollTop + 16 || bottom > el.scrollTop + el.clientHeight - 16) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' })
  })
}
watch(
  () => (draft.value ? `${draft.value.day}|${draft.value.start}|${draft.value.end}` : ''),
  () => {
    const d = draft.value
    if (d) reveal(d.day, d.start, d.end)
  },
)
async function onSaved(e: Entry): Promise<void> {
  const p = panel.value
  if (p?.type === 'entry') panel.value = { type: 'entry', day: p.day, entry: e, key: e.id }
  await reloadVisible()
}
async function onPanelClosed(): Promise<void> {
  panel.value = undefined
  await reloadVisible()
}
function openJira(key: string): void {
  if (jira.value.siteUrl) window.qa.openExternal(`${jira.value.siteUrl}/browse/${key}`)
}
const openUrl = (url: string) => window.qa.openExternal(url)
/** Everything it is linked with — on its day (a click opens it here) or another day (a click goes there). */
function linksOf(day: string, type: 'entry' | 'note', id: string) {
  return linkedTo(days.value.get(day)?.links ?? [], { type, id }).map(({ other }) => {
    const oday = other.day ?? day
    const d = days.value.get(oday)
    const e = other.type === 'entry' ? d?.entries.find((x) => x.id === other.id) : undefined
    const n = other.type === 'note' ? d?.notes.find((x) => x.id === other.id) : undefined
    const text = e ? titleOf(e) : n ? n.text || n.transcript || (n.audio ? 'Аудиозаметка' : 'Заметка') : (other.hint ?? '')
    const time = e ? `${formatHM(e.start)}–${formatHM(e.end)}` : n ? formatHM(n.at) : ''
    const icon = e ? entryIcon(e) : n ? (n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note') : 'link'
    const color = e ? kindColor(e.kind) : '#fbbf24'
    // a click: the calendar goes there and the panel opens it
    const open = () => {
      if (e) {
        reveal(oday, e.start, e.end)
        openEntry(e, oday)
      } else if (n) {
        reveal(oday, n.at, n.at + 15 * MINUTE)
        openNote(oday, { id: n.id, at: n.at, text: n.text, taskId: n.taskId })
      } else emit('openDay', oday)
    }
    return { key: other.id, day: oday, other: oday !== day, text: time ? `${formatHM(e?.start ?? n!.at)} ${text}` : text, title: text, time, icon, color, open }
  })
}
const panelLinks = computed(() => {
  const p = panel.value
  const me = panelEntry.value ?? (p?.type === 'note' ? { id: p.note.id } : undefined)
  if (!p || !me) return []
  return linksOf(p.day, p.type === 'note' ? 'note' : 'entry', me.id)
})
/** The list under an event's link badge. */
const linkMenu = ref<{ day: string; id: string; style: Record<string, string>; up: boolean }>()
const linkMenuItems = computed(() => (linkMenu.value ? linksOf(linkMenu.value.day, 'entry', linkMenu.value.id) : []))
function toggleLinkMenu(ev: MouseEvent, e: Entry, day: string): void {
  if (linkMenu.value?.id === e.id) return void (linkMenu.value = undefined)
  const f = placeFloat(ev.currentTarget as HTMLElement, 300, true, 16)
  linkMenu.value = { day, id: e.id, style: { ...f.style, maxHeight: `${f.maxH}px` }, up: f.up }
}
function pickLink(x: { open: () => void }): void {
  linkMenu.value = undefined
  x.open()
}
function onMenuOutside(e: PointerEvent): void {
  if (linkMenu.value && !(e.target as HTMLElement).closest('.lmenu, .lbadge')) linkMenu.value = undefined
}
window.addEventListener('pointerdown', onMenuOutside, true)
onBeforeUnmount(() => window.removeEventListener('pointerdown', onMenuOutside, true))
// the list stays by its badge: moving the calendar closes it
watch([start, span, zy], () => (linkMenu.value = undefined))
/** The events and notes around the open one, in time order (across the loaded days) — a click switches. */
type Item = { key: string; t: number; day: string; text: string; time: string; color: string; icon: string; open: () => void }
const allItems = computed<Item[]>(() => {
  const out: Item[] = []
  for (const [day, d] of days.value) {
    for (const e of d.entries.filter(visibleEntry))
      out.push({ key: e.id, t: e.start, day, text: titleOf(e), time: `${formatHM(e.start)}–${formatHM(e.end)}`, color: kindColor(e.kind), icon: entryIcon(e), open: () => openEntry(e, day) })
    for (const n of visibleNotes(d.notes))
      out.push({
        key: n.id,
        t: n.at,
        day,
        text: n.text || n.transcript || (n.audio ? 'Аудиозаметка' : 'Заметка'),
        time: formatHM(n.at),
        color: '#fbbf24',
        icon: n.audio ? (n.audio.kind === 'call' ? 'phone' : 'mic') : 'note',
        open: () => openNote(day, { id: n.id, at: n.at, text: n.text, taskId: n.taskId }),
      })
  }
  return out.sort((a, b) => a.t - b.t)
})
const neighbours = computed(() => {
  const p = panel.value
  if (!p) return { before: [], after: [] }
  const id = p.type === 'note' ? p.note.id : (p.entry as Partial<Entry>).id
  const at = p.type === 'note' ? p.note.at : p.entry.start
  const list = allItems.value
  let i = id ? list.findIndex((x) => x.key === id) : -1
  if (i < 0) i = list.findIndex((x) => x.t >= at)
  if (i < 0) i = list.length
  const self = id && list[i]?.key === id ? 1 : 0
  return { before: list.slice(Math.max(0, i - NEIGHBOURS), i), after: list.slice(i + self, i + self + NEIGHBOURS) }
})
const NEIGHBOURS = 30
/** Items grouped by day (the date stands on the left of each group). */
function byDay(list: Item[]): Array<{ day: string; items: Item[] }> {
  const out: Array<{ day: string; items: Item[] }> = []
  for (const x of list) {
    const last = out[out.length - 1]
    if (last && last.day === x.day) last.items.push(x)
    else out.push({ day: x.day, items: [x] })
  }
  return out
}
const beforeGroups = computed(() => byDay(neighbours.value.before))
const afterGroups = computed(() => byDay(neighbours.value.after))
/** The open card is kept in the middle of the list. */
const curEl = ref<HTMLElement>()
watch(
  () => (panel.value ? (panel.value.type === 'note' ? panel.value.note.id : panel.value.key) : undefined),
  () => void nextTick(() => curEl.value?.scrollIntoView({ block: 'center' })),
)
/** The side panel's width: drag its left edge (remembered). */
const sideW = ref(readSideW())
function readSideW(): number {
  try {
    return Math.min(900, Math.max(320, Number(localStorage.getItem('qa.tcalSide')) || 440))
  } catch {
    return 440
  }
}
const sideDrag = ref(false)
function onSideResize(e: PointerEvent): void {
  const x0 = e.clientX
  const w0 = sideW.value
  sideDrag.value = true
  document.body.style.cursor = 'col-resize'
  const move = (ev: PointerEvent) => (sideW.value = Math.min(900, Math.max(320, w0 + (x0 - ev.clientX))))
  const up = () => {
    sideDrag.value = false
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', move)
    try {
      localStorage.setItem('qa.tcalSide', String(Math.round(sideW.value)))
    } catch {
      // not remembered — fine
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}
/** The date button opens the browser's calendar. */
const dateInput = ref<HTMLInputElement>()
function pickDate(): void {
  if (dateLocked.value) return
  try {
    dateInput.value?.showPicker()
  } catch {
    dateInput.value?.focus()
  }
}
/** A saved note keeps its day (only a new one can be put on another). */
const dateLocked = computed(() => (panel.value?.type === 'note' && !panel.value.note.isNew) || !!panelEntry.value?.outlook)
/** The date field of the panel: a new event / note moves to that day; an existing event is moved there. */
async function setPanelDay(day: string): Promise<void> {
  const p = panel.value
  if (!p || !day || day === p.day) return
  const shift = dayStart(day) - dayStart(p.day)
  if (p.type === 'note') {
    if (p.note.isNew) panel.value = { type: 'note', day, note: { ...p.note, at: p.note.at + shift } }
    return
  }
  const e = panelEntry.value
  if (e) {
    await window.qa.moveEntry(p.day, day, e.id, e.start + shift, e.end + shift)
    await reloadVisible()
    const f = findEntry(e.id)
    if (f) panel.value = { type: 'entry', day: f.day, entry: f.e, key: f.e.id }
  } else panel.value = { ...p, day, entry: { ...p.entry, start: p.entry.start + shift, end: p.entry.end + shift }, key: `${p.key}d` }
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && linkMenu.value) return void (linkMenu.value = undefined)
  if (e.key === 'Escape' && panel.value && !(e.target as HTMLElement).closest('input, textarea')) panel.value = undefined
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---------- links drawn here — also between days ----------
const layer = ref<InstanceType<typeof LinkLayer>>()
const dayOfEnd = (e: LinkEnd) =>
  e.type === 'entry' ? findEntry(e.id)?.day : [...days.value.values()].find((d) => d.notes.some((x) => x.id === e.id))?.day
async function onLink(a: LinkEnd, b: LinkEnd): Promise<void> {
  const da = dayOfEnd(a)
  const db = dayOfEnd(b)
  if (!da || !db) return
  if (da === db) await window.qa.link(da, a, b)
  else await window.qa.link(da, { ...a, day: da }, { ...b, day: db })
  await reloadVisible()
}
async function onUnlink(id: string): Promise<void> {
  const day = [...days.value.values()].find((d) => d.links?.some((l) => l.id === id))?.day
  if (!day) return
  await window.qa.unlink(day, id)
  await reloadVisible()
}
const isToday = (d: string) => d === today.value
</script>

<template>
  <div class="tcal">
    <div class="bar">
      <button class="btoday" @click="goToday">Сегодня</button>
      <span class="ttl">{{ rangeText }}</span>
      <span class="grow"></span>
      <button class="add" title="Новое событие" @click="addEvent"><Icon name="plus" :size="13" />Событие</button>
      <button class="add note" title="Новая заметка" @click="addNote"><Icon name="note" :size="13" />Заметка</button>
      <input v-model="q" class="search" placeholder="Поиск" spellcheck="false" />
      <button class="tog" :class="{ on: onlyProductive }" title="Только продуктивные виды" @click="onlyProductive = !onlyProductive">Продуктивные</button>
      <button class="tog" :class="{ on: showLinks }" title="Линии связей" @click="showLinks = !showLinks"><Icon name="link" :size="12" />Связи</button>
      <span class="seg" title="Масштаб — или Ctrl + колесо мыши">
        <button v-for="p in PRESETS" :key="p.days" :class="{ on: nearPreset === p.days }" @click="zoomTo(p.days)">{{ p.label }}</button>
      </span>
    </div>

    <KindMenu
      v-if="cmenu"
      :x="cmenu.x"
      :y="cmenu.y"
      :title="cmenu.entry ? (cmenu.entry.outlook ? 'Встреча из Outlook' : 'Изменить вид') : `Новое событие · ${formatHM(cmenu.t)}`"
      :current="cmenu.entry?.kind"
      :no-kinds="!!cmenu.entry?.outlook"
      @pick="onMenuKind"
      @close="cmenu = undefined"
    >
      <p v-if="cmenu.entry?.outlook" class="cm-note">Время, название и вид меняет только Outlook. Напоминание и связи — в карточке.</p>
      <div class="cm-sep"></div>
      <template v-if="cmenu.entry">
        <button class="cm-act" @click="menuOpen"><Icon name="pencil" :size="14" />Открыть</button>
        <button v-if="!cmenu.entry.outlook" class="cm-act del" @click="menuDelete"><Icon name="trash" :size="14" />{{ cmenu.entry.series ? 'Удалить…' : 'Удалить' }}</button>
      </template>
      <button v-else class="cm-act" @click="menuNote"><Icon name="note" :size="14" />Заметка здесь</button>
    </KindMenu>
    <Teleport to="body">
      <div v-if="linkMenu" class="lmenu" :class="{ up: linkMenu.up }" :style="linkMenu.style" @pointerdown.stop>
        <div class="lmh"><Icon name="link" :size="11" />Связано</div>
        <button v-for="x in linkMenuItems" :key="x.key" class="lmi" :style="{ '--c': x.color }" :title="x.title" @click="pickLink(x)">
          <Icon :name="x.icon" :size="11" :stroke="2.4" />
          <span class="lmt">{{ x.other ? `${fmt(x.day, { day: 'numeric', month: 'short' })} · ` : '' }}{{ x.time }}</span>
          <span class="lmx">{{ x.title }}</span>
        </button>
        <div v-if="!linkMenuItems.length" class="lme">Связанные записи не загружены</div>
      </div>
    </Teleport>
    <div class="wrap">
      <div class="strip" :class="{ roomy }">
        <!-- dates: fixed on top -->
        <div class="shead">
          <div class="corner"></div>
          <div ref="head" class="hcanvas">
            <div
              v-for="n in visibleNums"
              :key="`hc${n}`"
              class="col"
              :class="{ off: isOff(n), today: n === todayNum, month: toKey(n).endsWith('-01'), sep: colW >= 8, hov: hover?.n === n }"
              :style="{ left: `${xOf(n)}px`, width: `${widthOf(n)}px` }"
            ></div>
            <div class="mrow">
              <span v-for="m in months" :key="m.key" class="mlabel" :style="{ left: `${m.x}px`, maxWidth: `${Math.max(0, m.w)}px` }">{{ m.label }}</span>
            </div>
            <div class="drow">
              <template v-for="n in visibleNums" :key="`d${n}`">
                <button
                  v-if="dayLabel(n)"
                  class="dlabel"
                  :class="{ today: n === todayNum, off: isOff(n), hov: hover?.n === n }"
                  :style="{ left: `${xOf(n)}px`, width: `${Math.max(widthOf(n), 18)}px` }"
                  title="Открыть день в таймлайне"
                  @click.stop="emit('openDay', toKey(n))"
                >
                  {{ dayLabel(n) }}
                </button>
              </template>
            </div>
          </div>
        </div>

        <!-- hours: scroll vertically -->
        <div ref="body" class="sbody">
          <div class="hours" title="Колесо мыши" @dblclick="resetHours">
            <div v-for="h in hours" :key="h" class="hr" :style="{ height: `${hourPx}px` }">{{ h && hourPx >= 13 ? `${String(h).padStart(2, '0')}:00` : h % 3 === 0 && h ? `${String(h).padStart(2, '0')}` : '' }}</div>
            <div v-for="s in subLines" :key="`s${s.label}`" class="hsub" :class="{ half: s.half }" :style="{ top: `${s.y}px` }">{{ s.label }}</div>
          </div>
          <div
            ref="canvas"
            class="canvas"
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
              class="col"
              :class="{ off: isOff(n), today: n === todayNum, month: toKey(n).endsWith('-01'), sep: colW >= 8 }"
              :style="{ left: `${xOf(n)}px`, width: `${widthOf(n)}px` }"
            ></div>
            <div v-for="h in hours" :key="`h${h}`" class="hline" :style="{ top: `${h * hourPx}px` }"></div>
            <div v-for="s in subLines" :key="`sl${s.label}`" class="hline sub" :class="{ half: s.half }" :style="{ top: `${s.y}px` }"></div>

            <!-- the pointer's moment on the day: a line + "+" to add an event there -->
            <template v-if="hover && (!g || g.kind === 'pending') && colW >= 40">
              <div class="hcur" :style="{ left: `${xOf(hover.n)}px`, width: `${widthOf(hover.n)}px`, top: `${yOf(hover.t, toKey(hover.n))}px` }">
                <span class="hcur-t">{{ formatHM(hover.t) }}</span>
              </div>
              <button
                class="hplus"
                :style="{ left: `${xOf(hover.n) + widthOf(hover.n) - 24}px`, top: `${yOf(hover.t, toKey(hover.n)) - 10}px` }"
                :title="`Новое событие ${formatHM(hover.t)}`"
                @pointerdown.stop
                @click.stop="openDraft(toKey(hover.n), hover.t, hover.t + 30 * MINUTE)"
              ><Icon name="plus" :size="13" :stroke="2.6" /></button>
            </template>
            <!-- the new event being set up in the panel -->
            <div
              v-if="draft"
              class="draftev"
              :style="{ left: `${xOf(draft.n) + GUT}px`, width: `${widthOf(draft.n) - 2 * GUT}px`, top: `${yOf(draft.start, draft.day)}px`, height: `${Math.max(18, ((draft.end - draft.start) / HOUR) * hourPx - 1)}px` }"
            >
              <span>Новое событие · {{ formatHM(draft.start) }}–{{ formatHM(draft.end) }}</span>
            </div>
            <!-- a new event being drawn -->
            <div
              v-if="g?.kind === 'create'"
              class="newev"
              :style="{ left: `${xOf(g.day) + GUT}px`, width: `${widthOf(g.day) - 2 * GUT}px`, top: `${yOf(Math.min(g.t0, g.t1), toKey(g.day))}px`, height: `${Math.max(4, (Math.abs(g.t1 - g.t0) / HOUR) * hourPx)}px` }"
            >
              {{ formatHM(Math.min(g.t0, g.t1)) }}–{{ formatHM(Math.max(g.t0, g.t1)) }}
            </div>

            <!-- events -->
            <div
              v-for="p in placed"
              :key="p.e.id"
              class="ev"
              :class="{ future: p.e.start > nowMs, thin: p.w < 40, dragging: p.dragging, sel: selectedId === p.e.id }"
              :data-entry="p.e.id"
              :style="{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, '--c': kindColor(p.e.kind), '--lines': p.lines }"
              :title="`${formatHM(p.e.start)}–${formatHM(p.e.end)} ${p.e.task ? p.e.task.key + ' ' : ''}${titleOf(p.e)}`"
            >
              <template v-if="p.w >= 40">
                <div v-if="p.lines" class="et"><Icon :name="entryIcon(p.e)" :size="10" :stroke="2.4" class="eic" /><span v-if="p.e.task" class="key">{{ p.e.task.key }}</span> {{ titleOf(p.e) }}<Icon v-if="p.e.series" name="repeat" :size="9" :stroke="2.4" class="eflag" /><Icon v-if="p.e.remind && !p.e.remind.fired" name="bell" :size="9" :stroke="2.4" class="eflag" /></div>
                <div v-if="p.time" class="em">{{ formatHM(p.e.start) }}–{{ formatHM(p.e.end) }}</div>
                <button
                  v-if="!linesShown && linkCount.get(p.e.id) && p.h >= 12"
                  class="lbadge"
                  :class="{ on: linkMenu?.id === p.e.id }"
                  :title="`Связей: ${linkCount.get(p.e.id)} — клик: список`"
                  @pointerdown.stop
                  @click.stop="toggleLinkMenu($event, p.e, p.day)"
                ><Icon name="link" :size="9" :stroke="2.6" />{{ linkCount.get(p.e.id) }}</button>
              </template>
            </div>

            <!-- notes -->
            <div
              v-if="fanZone"
              class="fanzone"
              :style="{ left: `${fanZone.left}px`, top: `${fanZone.top}px`, width: `${fanZone.width}px`, height: `${fanZone.height}px`, zIndex: 8 }"
              @pointerenter="fan.enter(fan.open.value!)"
              @pointerleave="fan.leave()"
            ></div>
            <button
              v-for="p in notePins"
              :key="p.note.id"
              class="npin"
              :data-note="p.note.id"
              :style="{ left: `${p.x}px`, top: `${p.y - 7}px`, transform: fan.shift(pinPlaces.get(p.note.id), 18, -1), zIndex: 8 + (pinPlaces.get(p.note.id)?.n ?? 1) - (pinPlaces.get(p.note.id)?.i ?? 0) }"
              @pointerenter="pinPlaces.get(p.note.id) && fan.enter(pinPlaces.get(p.note.id)!.key)"
              @pointerleave="fan.leave()"
              :title="`${formatHM(p.note.at)} ${p.note.text || p.note.transcript || (p.note.audio ? 'Аудиозаметка' : '')}`"
              @pointerdown.stop="layer?.startDrag($event, { type: 'note', id: p.note.id })"
              @click.stop="openNote(p.day, { id: p.note.id, at: p.note.at, text: p.note.text, taskId: p.note.taskId })"
            >
              <Icon :name="p.note.audio ? (p.note.audio.kind === 'call' ? 'phone' : 'mic') : 'note'" :size="9" :stroke="2.4" />
            </button>

            <div v-if="todayNum >= firstDay && todayNum <= lastDay" class="now" :style="{ left: `${xOf(todayNum)}px`, width: `${widthOf(todayNum)}px`, top: `${nowY}px` }"></div>
            <LinkLayer ref="layer" :sides="colW >= 40" :links="allLinks" :entries="allEntries" :link-style="linkStyle" :tick="[start, span, W, H, placed]" @link="onLink" @unlink="onUnlink" />
          </div>
        </div>

        <!-- footer: per day -->
        <div class="sfoot">
          <div class="corner fl">Итого</div>
          <div class="fcanvas">
            <template v-for="st in stats" :key="`f${st.n}`">
              <div
                v-if="colW >= 34 && (st.done || st.planned || st.notes || st.plan)"
                class="fcell"
                :class="{ off: isOff(st.n) }"
                :style="{ left: `${xOf(st.n)}px`, width: `${widthOf(st.n)}px` }"
                :title="`${fmt(st.day, { weekday: 'long', day: 'numeric', month: 'long' })}\nсделано ${formatDuration(st.done)} · продуктивно ${formatDuration(st.productive)}\nзапланировано ${formatDuration(st.planned)}\nсобытий ${st.count} · задач ${st.tasks} · встреч и созвонов ${st.meetings} · заметок ${st.notes}`"
              >
                <template v-if="st.plan && widthOf(st.n) >= 170">
                  <span class="frow"><span class="muted">План</span><b>{{ formatDuration(st.plan) }}</b><span class="muted">Факт</span><b>{{ formatDuration(st.done) }}</b></span>
                  <span class="fbar"><span :style="{ width: `${Math.min(100, (st.done / st.plan) * 100)}%` }"></span><em>{{ Math.round((st.done / st.plan) * 100) }}%</em></span>
                </template>
                <span v-else class="frow">
                  <b v-if="st.done">{{ formatDuration(st.done) }}</b>
                  <span v-if="colW >= 110 && st.productive && st.productive !== st.done" class="fp">прод. {{ formatDuration(st.productive) }}</span>
                </span>
                <span v-if="colW >= 70 && st.planned" class="fpl">+{{ formatDuration(st.planned) }} план</span>
                <span v-if="colW >= 60" class="fcount">
                  <span :title="'Событий'"><Icon name="list" :size="9" />{{ st.count }}</span>
                  <span v-if="st.tasks" :title="'Задач'"><Icon name="checkSquare" :size="9" />{{ st.tasks }}</span>
                  <span v-if="colW >= 96 && st.meetings" :title="'Встреч и созвонов'"><Icon name="users" :size="9" />{{ st.meetings }}</span>
                  <span v-if="colW >= 120 && st.notes" :title="'Заметок'"><Icon name="note" :size="9" />{{ st.notes }}</span>
                </span>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- side panel -->
      <!-- the whole gap between the calendar and the panel is the handle -->
      <div v-if="panel" class="sgap" :class="{ on: sideDrag }" title="Потяните — ширина панели" @pointerdown.prevent.stop="onSideResize"></div>
      <aside v-if="panel" class="side" :style="{ width: `${sideW}px` }" @pointerdown.stop>
        <div class="sh">
          <span class="muted small">{{ panel.type === 'note' ? 'Заметка' : 'Событие' }} · по времени</span>
          <span class="grow"></span>
          <button class="ib" title="Открыть день в таймлайне" @click="emit('openDay', panel.day)"><Icon name="timeline" :size="14" /></button>
          <button class="ib" title="Закрыть (Esc)" @click="onPanelClosed"><Icon name="x" :size="15" /></button>
        </div>
        <div class="slist">
        <div v-for="g in beforeGroups" :key="g.day" class="ngroup">
          <div class="gday" :class="{ off: isOff(toNum(g.day)) }"><span>{{ fmt(g.day, { weekday: 'short' }) }}</span><b>{{ +g.day.slice(8) }}</b><small>{{ fmt(g.day, { month: 'short' }) }}</small></div>
          <div class="gitems">
            <button v-for="x in g.items" :key="x.key" class="nbr" :style="{ '--c': x.color }" @click="x.open()">
              <Icon :name="x.icon" :size="10" :stroke="2.4" /><span class="nt">{{ x.time }}</span><span class="nx">{{ x.text }}</span>
            </button>
          </div>
        </div>

        <!-- the open one: highlighted, its date on the left like the others -->
        <div ref="curEl" class="ngroup current">
          <div class="gday" :class="{ off: isOff(toNum(panel.day)) }"><span>{{ fmt(panel.day, { weekday: 'short' }) }}</span><b>{{ +panel.day.slice(8) }}</b><small>{{ fmt(panel.day, { month: 'short' }) }}</small></div>
          <div class="ccard">
          <template v-if="panel.type === 'entry'">
            <EntryEditor
              :key="panel.key"
              :day="panel.day"
              :entry="panelEntry ?? panel.entry"
              :spans="panelDay?.spans ?? []"
              :recent="[]"
              :now="isToday(panel.day) ? nowMs : undefined"
              :entries="panelDay?.entries ?? []"
              :notes="panelDay?.notes ?? []"
              :links="panelDay?.links ?? []"
              textarea
              @saved="onSaved"
              @deleted="onPanelClosed"
              @close="onPanelClosed"
              @range="onDraftRange"
            >
              <template #date>
              <div class="pdate-row">
                <button class="pdate" :disabled="dateLocked" :title="dateLocked ? 'Дата заметки' : 'Выбрать другой день'" @click="pickDate">
                  <Icon name="calendar" :size="13" />{{ cap(fmt(panel.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) }}
                  <Icon v-if="!dateLocked" name="chevronDown" :size="12" />
                </button>
                <input ref="dateInput" class="picker" type="date" tabindex="-1" :value="panel.day" @change="setPanelDay(($event.target as HTMLInputElement).value)" />
              </div>
            </template>
            </EntryEditor>
            <div v-if="panelEntry && (panelEntry.task || panelEntry.outlook || panelLinks.length)" class="sinfo">
              <div v-if="panelEntry.task" class="srow">
                <Icon :name="panelEntry.task.key.startsWith('Q-') ? 'checkSquare' : 'jira'" :size="12" />
                <b>{{ panelEntry.task.key }}</b>
                <span class="muted">всего по задаче {{ formatDuration(totals[panelEntry.task.key] ?? 0) }}</span>
                <button v-if="!panelEntry.task.key.startsWith('Q-')" class="lnk" @click="openJira(panelEntry.task.key)">в Jira</button>
              </div>
              <div v-if="panelEntry.outlook" class="srow">
                <Icon name="outlook" :size="12" />Встреча из Outlook
                <button v-if="panelEntry.outlook.joinUrl && panelEntry.end > nowMs" class="lnk" @click="openUrl(panelEntry.outlook.joinUrl)">Teams</button>
              </div>
              <div v-for="x in panelLinks" :key="x.key" class="srow">
                <Icon name="link" :size="12" />
                <span v-if="x.other" class="muted">{{ fmt(x.day, { day: 'numeric', month: 'short' }) }}</span>
                <button class="lnk ell" :title="x.text" @click="x.open()">{{ x.text }}</button>
              </div>
            </div>
          </template>
          <template v-else>
            <NoteEditor
              :key="panel.note.id"
              :day="panel.day"
              :note="panel.note"
              :entries="panelDay?.entries ?? []"
              :notes="panelDay?.notes ?? []"
              :links="panelDay?.links ?? []"
              :full="panelDay?.notes.find((x) => x.id === panelNoteId)"
              @close="onPanelClosed"
              @saved="reloadVisible"
            >
              <template #date>
              <div class="pdate-row">
                <button class="pdate" :disabled="dateLocked" :title="dateLocked ? 'Дата заметки' : 'Выбрать другой день'" @click="pickDate">
                  <Icon name="calendar" :size="13" />{{ cap(fmt(panel.day, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })) }}
                  <Icon v-if="!dateLocked" name="chevronDown" :size="12" />
                </button>
                <input ref="dateInput" class="picker" type="date" tabindex="-1" :value="panel.day" @change="setPanelDay(($event.target as HTMLInputElement).value)" />
              </div>
            </template>
            </NoteEditor>
            <div v-if="panelLinks.length" class="sinfo">
              <div v-for="x in panelLinks" :key="x.key" class="srow">
                <Icon name="link" :size="12" />
                <span v-if="x.other" class="muted">{{ fmt(x.day, { day: 'numeric', month: 'short' }) }}</span>
                <button class="lnk ell" :title="x.text" @click="x.open()">{{ x.text }}</button>
              </div>
            </div>
          </template>
          </div>
        </div>

        <div v-for="g in afterGroups" :key="g.day" class="ngroup">
          <div class="gday" :class="{ off: isOff(toNum(g.day)) }"><span>{{ fmt(g.day, { weekday: 'short' }) }}</span><b>{{ +g.day.slice(8) }}</b><small>{{ fmt(g.day, { month: 'short' }) }}</small></div>
          <div class="gitems">
            <button v-for="x in g.items" :key="x.key" class="nbr" :style="{ '--c': x.color }" @click="x.open()">
              <Icon :name="x.icon" :size="10" :stroke="2.4" /><span class="nt">{{ x.time }}</span><span class="nx">{{ x.text }}</span>
            </button>
          </div>
        </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.tcal {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.btoday {
  padding: 4px 12px;
  font-size: 13px;
}
.ttl {
  margin-left: 8px;
  font-size: 17px;
  font-weight: 600;
}
.grow {
  flex: 1;
}
.add {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  font-size: 12px;
}
.add.note {
  color: #fde68a;
}
.search {
  width: 140px;
  padding: 4px 8px;
  font-size: 12px;
}
.tog {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.tog.on {
  border-color: rgba(124, 108, 246, 0.6);
  background: rgba(124, 108, 246, 0.16);
  color: var(--text);
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}
.seg button {
  padding: 3px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
}
.seg button.on {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

/* ---------- layout: the strip + the side panel ---------- */
.wrap {
  display: flex;
  gap: 0;
  height: calc(100vh - 200px);
  min-height: 440px;
}
.strip {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--panel);
}
.side {
  position: relative;
  flex: none;
  max-width: 60%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 8px 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  overflow-y: auto;
}
.sh {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
}
.small {
  font-size: 11px;
}
.ib {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}
.ib:hover {
  background: var(--hover);
  color: var(--text);
}
.sinfo {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}
.srow {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lnk {
  padding: 0;
  border: 0;
  background: transparent;
  color: #a5b4fc;
  font-size: 12px;
}

/* ---------- the strip ---------- */
.shead,
.sfoot {
  flex: none;
  display: flex;
}
.shead {
  height: 46px;
  border-bottom: 1px solid var(--border);
}
.sfoot {
  height: 50px;
  border-top: 1px solid var(--border);
}
.corner {
  flex: none;
  width: 50px;
  border-right: 1px solid var(--border);
}
.corner.fl {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
  box-sizing: border-box;
  font-size: 10.5px;
  color: var(--muted);
}
.hcanvas,
.fcanvas {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.fcell {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 5px;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 10.5px;
  line-height: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.fcell.off {
  background: rgba(248, 113, 113, 0.05);
}
.fcell b {
  font-size: 11.5px;
}
.fp {
  color: #bbf7d0;
}
.frow {
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.fcount {
  display: flex;
  gap: 7px;
  color: var(--muted);
  font-size: 10px;
}
.fcount span {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.fpl {
  color: var(--muted);
}
.sbody {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  overflow-y: auto;
  overflow-x: hidden;
}
.sbody::-webkit-scrollbar {
  width: 6px;
}
.hours {
  flex: none;
  width: 50px;
  border-right: 1px solid var(--border);
}
.hours {
  position: relative;
  cursor: ns-resize;
  user-select: none;
}
.hsub {
  position: absolute;
  right: 6px;
  font-size: 9px;
  line-height: 1;
  color: var(--muted);
  opacity: 0.55;
  transform: translateY(-4px);
  pointer-events: none;
}
.hsub.half {
  opacity: 0.8;
}
.hline.sub {
  border-top-style: dashed;
  border-top-color: rgba(255, 255, 255, 0.03);
}
.hline.sub.half {
  border-top-color: rgba(255, 255, 255, 0.045);
}
.hr {
  box-sizing: border-box;
  padding: 0 6px 0 0;
  text-align: right;
  font-size: 10.5px;
  line-height: 1;
  color: var(--muted);
  transform: translateY(-5px);
}
.canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  flex-shrink: 0;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}
.canvas.panning {
  cursor: grabbing;
}
.col {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  pointer-events: none;
}
.col.sep {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
}
.strip.roomy .col.sep {
  border-left-color: rgba(255, 255, 255, 0.07);
}
.col.off {
  background: rgba(248, 113, 113, 0.05);
}
.col.month {
  border-left: 1px solid rgba(148, 163, 184, 0.45);
}
.col.today {
  background: rgba(59, 130, 246, 0.1);
}
.hcanvas .col.hov {
  background: rgba(139, 124, 255, 0.16);
  box-shadow: inset 0 -2px 0 #8b7cff;
}
.dlabel.hov {
  color: #fff;
  font-weight: 700;
}
.hline {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  pointer-events: none;
}
.mrow,
.drow {
  position: absolute;
  left: 0;
  right: 0;
  height: 22px;
  pointer-events: none;
}
.mrow {
  top: 0;
}
.drow {
  top: 22px;
}
.mlabel {
  position: absolute;
  top: 3px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dlabel {
  position: absolute;
  top: 0;
  height: 22px;
  display: flex;
  align-items: center;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: auto;
  cursor: pointer;
}
.dlabel:hover {
  color: #a5b4fc;
}
.dlabel.off {
  color: #f87171;
}
.dlabel.today {
  color: #93c5fd;
  font-weight: 700;
}
/* events: the text close to the edges, smaller; the title wraps as far as the event is tall */
.ev {
  position: absolute;
  box-sizing: border-box;
  padding: 1px 3px 1px 4px;
  border-left: 3px solid var(--c);
  border-radius: 4px;
  background: color-mix(in srgb, var(--c) 30%, #11131a);
  color: var(--text);
  font-size: 10.5px;
  line-height: 12.5px;
  overflow: hidden;
  cursor: grab;
  z-index: 1;
}
.ev::before,
.ev::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 5px;
  cursor: ns-resize;
  user-select: none;
}
.ev::before {
  top: 0;
}
.ev::after {
  bottom: 0;
}
.ev.thin {
  padding: 0;
  border-left: 0;
  border-radius: 1.5px;
  background: var(--c);
  opacity: 0.85;
}
.ev:hover {
  z-index: 3;
  filter: brightness(1.2);
}
.ev.sel {
  box-shadow:
    0 0 0 2px #fff,
    0 4px 14px rgba(0, 0, 0, 0.5);
  z-index: 4;
}
.ev.dragging {
  z-index: 5;
  cursor: grabbing;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
  opacity: 0.92;
}
.ev.future {
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0 4px, transparent 4px 9px),
    color-mix(in srgb, var(--c) 20%, #11131a);
  border-left-style: dashed;
}
.ev.thin.future {
  background: var(--c);
  opacity: 0.45;
}
.et {
  font-weight: 600;
  white-space: normal;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: var(--lines);
}
.eflag {
  display: inline-block;
  margin-left: 4px;
  vertical-align: -1px;
  opacity: 0.8;
}
.cm-note {
  max-width: 230px;
  margin: 0 6px 6px;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.4;
}
.cm-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
.cm-act {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}
.cm-act:hover {
  background: rgba(255, 255, 255, 0.07);
}
.cm-act.del {
  color: #fca5a5;
}
.eic {
  display: inline-block;
  margin-right: 2px;
  vertical-align: -1px;
}
.em {
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.key {
  color: #bfdbfe;
  font-weight: 600;
}
/* the new event: a dashed outline marching round until it is saved */
.draftev {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  padding: 3px 6px;
  border-radius: 5px;
  color: #e0e7ff;
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  background:
    linear-gradient(90deg, #a5b4fc 50%, transparent 0) repeat-x top left / 10px 1.5px,
    linear-gradient(90deg, #a5b4fc 50%, transparent 0) repeat-x bottom left / 10px 1.5px,
    linear-gradient(0deg, #a5b4fc 50%, transparent 0) repeat-y top left / 1.5px 10px,
    linear-gradient(0deg, #a5b4fc 50%, transparent 0) repeat-y top right / 1.5px 10px,
    rgba(124, 108, 246, 0.2);
  animation: ants 0.7s linear infinite;
}
@keyframes ants {
  to {
    background-position:
      10px 0,
      -10px 100%,
      0 -10px,
      100% 10px,
      0 0;
  }
}
.fbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 10px;
}
.fbar span {
  display: block;
  height: 4px;
  border-radius: 2px;
  background: #3b82f6;
  max-width: calc(100% - 34px);
}
.fbar em {
  font-style: normal;
  font-size: 10px;
  color: var(--muted);
}
.newev {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  padding: 2px 5px;
  border: 1px dashed #a5b4fc;
  border-radius: 4px;
  background: rgba(124, 108, 246, 0.25);
  color: #fff;
  font-size: 10.5px;
  pointer-events: none;
}
.npin {
  position: absolute;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: #fbbf24;
  color: #1c1917;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.now {
  position: absolute;
  height: 2px;
  background: #ef4444;
  z-index: 4;
  pointer-events: none;
}
.hint {
  font-size: 11px;
}
.hcur {
  position: absolute;
  z-index: 2;
  height: 0;
  border-top: 1px solid rgba(165, 180, 252, 0.75);
  pointer-events: none;
}
.hcur-t {
  position: absolute;
  left: 2px;
  top: -14px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(17, 19, 26, 0.85);
  color: #c7d2fe;
  font-size: 10px;
}
.hplus {
  position: absolute;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #7c6cf6;
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
.hplus:hover {
  background: #8b7cff;
  transform: scale(1.1);
}
.lbadge {
  position: absolute;
  right: 2px;
  top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  border: 0;
  border-radius: 6px;
  background: rgba(17, 19, 26, 0.6);
  color: #ddd6fe;
  font-size: 9.5px;
  line-height: 13px;
  cursor: pointer;
}
.lbadge.on,
.lbadge:hover {
  background: rgba(124, 108, 246, 0.85);
  color: #fff;
}
.npin {
  transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}
/* under a fanned-out group of notes: the pointer may cross it without the group folding back */
.fanzone {
  position: absolute;
  border-radius: 8px;
  background: rgba(251, 191, 36, 0.08);
  cursor: default;
}
/* the list: days on the left, the open card highlighted in the middle */
.slist {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.ngroup {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 6px;
  align-items: start;
}
.gday {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 2px;
  line-height: 1.1;
  color: var(--muted);
  font-size: 10px;
  text-transform: lowercase;
}
.gday b {
  font-size: 17px;
  color: var(--text);
}
.gday.off,
.gday.off b {
  color: #f87171;
}
.gitems {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ngroup.current .gday b {
  color: #c4b5fd;
}
.sgap {
  position: relative;
  flex: none;
  width: 10px;
  cursor: col-resize;
}
.sgap::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 4px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s;
}
.sgap:hover::after,
.sgap.on::after {
  background: rgba(124, 108, 246, 0.85);
}
.ccard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(124, 108, 246, 0.6);
  background: rgba(124, 108, 246, 0.07);
  box-shadow: 0 0 0 3px rgba(124, 108, 246, 0.12);
}
.pdate-row {
  margin-top: -4px;
}
.pdate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
}
.pdate:hover:not(:disabled) {
  border-color: rgba(124, 108, 246, 0.6);
}
.pdate:disabled {
  border-color: transparent;
  color: var(--muted);
}
.picker {
  width: 0;
  height: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.nbr {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border: 0;
  border-left: 3px solid var(--c);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font-size: 11.5px;
  text-align: left;
  opacity: 0.8;
}
.nbr:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
  opacity: 1;
}
.nt {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.nx {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nd {
  flex: none;
  font-size: 10.5px;
}
</style>

<style>
/* the list under an event's link badge — teleported to <body> */
.lmenu {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px;
  overflow-y: auto;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #1b1e29;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.55);
  font-size: 12px;
  color: #e5e7eb;
}
.lmenu .lmh {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px 5px;
  font-size: 10.5px;
  color: #9ca3af;
}
.lmenu .lmi {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  border: 0;
  border-left: 3px solid var(--c);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.lmenu .lmi:hover {
  background: rgba(139, 124, 255, 0.18);
}
.lmenu .lmt {
  flex: none;
  color: #9ca3af;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.lmenu .lmx {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lmenu .lme {
  padding: 6px 8px;
  color: #9ca3af;
}
</style>
