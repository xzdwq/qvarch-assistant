import { visibleNotes } from '../notes'
import { formatDuration, MINUTE } from '../timeline'
import type { Entry, Ms, Note, PlanBlock } from '../types'

/**
 * The collapsed island pill without state: which chips fit, what they say, the day's totals, the date line,
 * the countdown to the next meeting, the orb's mood.
 */

/** The pill is as wide as its content, within these bounds (in 24px steps — no jitter). */
export const PILL_MIN = 360
export const PILL_MAX = 720
/** Handle, gaps, orb and paddings around the pill's two content lines. */
export const PILL_CHROME = 117
const CHIP_GAP = 4
const CHIP_AREA = PILL_MAX - PILL_CHROME
const NOTE_CHIP_W = 22

/** The pill's width for its content's natural width. */
export function pillWidthFor(contentPx: number): number {
  return Math.min(PILL_MAX, Math.max(PILL_MIN, Math.ceil((contentPx + PILL_CHROME) / 24) * 24))
}

/** One chip of the pill: a block, a note, the uncut tail, a planned block. */
export type PillItem =
  | { type: 'entry'; t: Ms; e: Entry }
  | { type: 'note'; t: Ms; n: Note }
  | { type: 'uncut'; t: Ms; ms: Ms; live: boolean }
  | { type: 'plan'; t: Ms; p: PlanBlock }

/** A chip shows its share of the work day; on a day off (no base) — its duration. */
export function chipText(ms: number, workMs: number): string {
  return workMs ? `${Math.max(1, Math.round((ms / workMs) * 100))}%` : ms < MINUTE ? '<1м' : formatDuration(ms)
}

/** Estimated text width (chips size to their content: "12%" or "1ч 05м"). */
const textW = (t: string) => t.length * 6.4
const chipW = (ms: number, workMs: number) => 30 + textW(chipText(ms, workMs))

/** Estimated width of a chip on the pill. */
export function pillItemWidth(it: PillItem, workMs: number): number {
  switch (it.type) {
    case 'entry':
      return chipW(it.e.end - it.e.start, workMs) + (it.e.task ? textW(it.e.task.key) + 4 : 0)
    case 'note':
      return NOTE_CHIP_W
    case 'plan':
      return chipW(it.p.end - it.p.start, workMs)
    case 'uncut':
      return chipW(it.ms, workMs) + 8
  }
}

/**
 * Blocks, notes and (if shown) what is still planned, in time order. Only the latest that fit are kept —
 * the pill never grows past its cap however busy the day is.
 */
export function pillItems(o: { entries: Entry[]; notes: Note[] | undefined; plan: PlanBlock[] | undefined; showPlan: boolean; now: Ms; workMs: number }): PillItem[] {
  const items: PillItem[] = [
    ...o.entries.map((e) => ({ type: 'entry' as const, t: e.start, e })),
    ...visibleNotes(o.notes).map((n) => ({ type: 'note' as const, t: n.at, n })),
    // what is still planned for today (dashed)
    ...(o.showPlan ? (o.plan ?? []).filter((p) => p.end > o.now).map((p) => ({ type: 'plan' as const, t: Math.max(p.start, o.now), p })) : []),
  ]
  items.sort((a, b) => a.t - b.t || (a.type === 'uncut' ? -1 : 1))
  const shown: PillItem[] = []
  let used = 0
  for (let i = items.length - 1; i >= 0; i--) {
    const w = pillItemWidth(items[i], o.workMs) + CHIP_GAP
    if (used + w > CHIP_AREA) break
    shown.unshift(items[i])
    used += w
  }
  return shown
}

/** The key a chip is rendered with. */
export function pillItemKey(it: PillItem): string {
  switch (it.type) {
    case 'entry':
      return it.e.id
    case 'note':
      return `n${it.n.id}`
    case 'plan':
      return `p${it.p.id}`
    case 'uncut':
      return `u${it.t}`
  }
}

/** Time per kind of block, longest first. */
export function kindTotals(entries: Entry[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const e of entries) m.set(e.kind, (m.get(e.kind) ?? 0) + (e.end - e.start))
  return [...m].sort((a, b) => b[1] - a[1])
}

/** Time per linked task, longest first. */
export function taskTotals(entries: Entry[]): Array<[string, { ms: number; summary: string }]> {
  const m = new Map<string, { ms: number; summary: string }>()
  for (const e of entries) {
    if (!e.task) continue
    const x = m.get(e.task.key) ?? { ms: 0, summary: e.task.summary }
    x.ms += e.end - e.start
    m.set(e.task.key, x)
  }
  return [...m].sort((a, b) => b[1].ms - a[1].ms)
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** "10 сб, окт 2026" for a day's start. */
export function islandDateText(dayStartMs: Ms): string {
  const d = new Date(dayStartMs)
  return `${d.getDate()} ${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "5м" / "1ч 05м" until a moment `ms` away (at least a minute). */
export function countdownText(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  return min < 60 ? `${min}м` : `${Math.floor(min / 60)}ч ${String(min % 60).padStart(2, '0')}м`
}

/** The orb's animations (a subset of thinking-orbs states). */
export type OrbMoodState = 'listening' | 'solving' | 'composing' | 'connecting' | 'weaving' | 'working'
export interface OrbMood {
  state: OrbMoodState
  /** The CSS variable of its tint (the orb paints on a canvas — the renderer reads the concrete colour). */
  tint: `--${string}`
  speed: number
  title: string
}
type OrbSignals = { recording: boolean; transcribing: boolean; noteOpen: boolean; inCall: boolean; dayFilled: boolean; offHours: boolean }

const orbTip = (t: string) => `${t}\nКлик — быстрая заметка`
/** The moods by priority: the first signal that holds wins. */
const ORB_MOODS: Array<[keyof OrbSignals, OrbMood]> = [
  ['recording', { state: 'listening', tint: '--orb-recording', speed: 1.4, title: 'Идёт запись — клик: открыть' }],
  ['transcribing', { state: 'solving', tint: '--orb-transcribing', speed: 1.8, title: 'Расшифровываю голос…' }],
  ['noteOpen', { state: 'composing', tint: '--orb-composing', speed: 1, title: 'Пишу заметку — клик по сфере, чтобы закончить' }],
  ['inCall', { state: 'listening', tint: '--orb-call', speed: 1, title: orbTip('Созвон — сфера слушает') }],
  ['dayFilled', { state: 'connecting', tint: '--orb-day-filled', speed: 1, title: orbTip('Рабочий день заполнен!') }],
  ['offHours', { state: 'weaving', tint: '--orb-off-hours', speed: 0.6, title: orbTip('Нерабочее время') }],
]
const ORB_WORKING: OrbMood = { state: 'working', tint: '--orb-working', speed: 1, title: orbTip('Работаем') }

/**
 * The orb mirrors what is going on, the first that holds wins: recording, transcribing, writing a note, a call,
 * the work day filled, after hours (or a day off), otherwise — working.
 */
export function orbMood(o: OrbSignals): OrbMood {
  return ORB_MOODS.find(([signal]) => o[signal])?.[1] ?? ORB_WORKING
}
