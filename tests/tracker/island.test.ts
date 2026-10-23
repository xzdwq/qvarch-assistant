import { describe, expect, it } from 'vitest'
import { DOCK_SIDE, DOCK_STRIP, ISLAND_PANEL_WIDTH, ISLAND_PILL, ISLAND_WINDOW } from '../../src/shared/island'
import type { Quick } from '../../src/shared/quickadd'
import { islandAxis } from '../../src/shared/tracker/islandAxis'
import { cutPlace, dayListRows, quickEventPlace } from '../../src/shared/tracker/islandCut'
import { dockLength, islandSize, NOTE_H, NOTE_W, pillHeight, shellTopAt } from '../../src/shared/tracker/islandGeometry'
import { chipText, countdownText, islandDateText, kindTotals, orbMood, PILL_MAX, PILL_MIN, pillItemKey, pillItems, pillWidthFor, taskTotals } from '../../src/shared/tracker/islandPill'
import type { Entry, Note, PlanBlock } from '../../src/shared/types'

const M = 60_000
const H = 60 * M
const DAY = '2026-10-12'
const NEXT = '2026-10-13'
const t = (hm: string, day = DAY) => new Date(`${day}T${hm}:00`).getTime()

const entry = (id: string, from: string, to: string, extra: Partial<Entry> = {}): Entry => ({ id, start: t(from), end: t(to), kind: 'task', label: id, source: 'manual', ...extra })
const note = (id: string, at: string, text = 'text'): Note => ({ id, at: t(at), text, updatedAt: 0 })
const quick = (q: Partial<Quick>): Quick => ({ label: '', day: DAY, parts: [], ...q })

describe('pill width and chips', () => {
  it('sizes the pill to its content in 24px steps within bounds', () => {
    expect(pillWidthFor(0)).toBe(PILL_MIN)
    expect(pillWidthFor(10_000)).toBe(PILL_MAX)
    expect(pillWidthFor(300) % 24).toBe(0)
    expect(pillWidthFor(300)).toBeGreaterThanOrEqual(300 + 117)
  })
  it('shows a share of the work day, or the duration on a day off', () => {
    expect(chipText(H, 8 * H)).toBe('13%')
    expect(chipText(1, 8 * H)).toBe('1%')
    expect(chipText(30_000, 0)).toBe('<1м')
    expect(chipText(30 * M, 0)).toBe('30м')
  })
  it('keeps the latest items that fit, in time order, notes and the plan included', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ ...entry(`e${i}`, '09:00', '09:10'), start: t('09:00') + i * 10 * M, end: t('09:00') + (i + 1) * 10 * M }))
    const shown = pillItems({ entries, notes: [note('n1', '15:25')], plan: [], showPlan: false, now: t('16:00'), workMs: 8 * H })
    expect(shown.length).toBeLessThan(41)
    expect(shown[shown.length - 1].type).toBe('entry')
    expect(shown.some((it) => it.type === 'note')).toBe(true)
    expect(shown.map((it) => it.t)).toEqual([...shown.map((it) => it.t)].sort((a, b) => a - b))
  })
  it('adds what is still planned only when switched on, starting at now', () => {
    const plan: PlanBlock[] = [{ id: 'p1', start: t('10:00'), end: t('12:00'), kind: 'task', label: 'p' }, { id: 'p0', start: t('08:00'), end: t('09:00'), kind: 'task', label: 'old' }]
    const on = pillItems({ entries: [], notes: [], plan, showPlan: true, now: t('11:00'), workMs: 8 * H })
    expect(on.map(pillItemKey)).toEqual(['pp1'])
    expect(on[0].t).toBe(t('11:00'))
    expect(pillItems({ entries: [], notes: [], plan, showPlan: false, now: t('11:00'), workMs: 8 * H })).toEqual([])
  })
  it('skips empty notes and keys items by type', () => {
    const shown = pillItems({ entries: [entry('a', '09:00', '10:00')], notes: [note('n', '09:30', ' '), note('m', '09:40')], plan: [], showPlan: false, now: t('12:00'), workMs: 0 })
    expect(shown.map(pillItemKey)).toEqual(['a', 'nm'])
  })
})

describe('day totals and texts', () => {
  it('sums per kind and per task, longest first', () => {
    const list = [entry('a', '09:00', '10:00', { kind: 'meet' }), entry('b', '10:00', '12:00', { task: { key: 'ABC-1', summary: 's' } }), entry('c', '12:00', '12:30', { task: { key: 'ABC-1', summary: 's' } })]
    expect(kindTotals(list)).toEqual([['task', 150 * M], ['meet', H]])
    expect(taskTotals(list)).toEqual([['ABC-1', { ms: 150 * M, summary: 's' }]])
  })
  it('writes the date and the countdown', () => {
    expect(islandDateText(t('00:00'))).toBe('12 пн, окт 2026')
    expect(countdownText(10_000)).toBe('1м')
    expect(countdownText(65 * M)).toBe('1ч 05м')
  })
  it('picks the orb mood by priority', () => {
    const base = { recording: false, transcribing: false, noteOpen: false, inCall: false, dayFilled: false, offHours: false }
    expect(orbMood(base).state).toBe('working')
    expect(orbMood({ ...base, offHours: true }).state).toBe('weaving')
    expect(orbMood({ ...base, offHours: true, dayFilled: true }).state).toBe('connecting')
    expect(orbMood({ ...base, inCall: true, noteOpen: true }).state).toBe('composing')
    expect(orbMood({ ...base, recording: true, transcribing: true }).tint).toBe('--orb-recording')
    expect(orbMood({ ...base, inCall: true }).title).toContain('Клик — быстрая заметка')
  })
})

describe('island geometry', () => {
  it('drops a row per hidden line, never below the orb', () => {
    expect(pillHeight({ chips: true, stats: true })).toBe(ISLAND_PILL.height)
    expect(pillHeight({ chips: false, stats: false })).toBe(Math.max(48, ISLAND_PILL.height - 41))
  })
  it('makes the slim pill as long as what it shows', () => {
    const none = { time: false, next: false, orb: false, wave: false }
    expect(dockLength(none, false)).toBe(150)
    expect(dockLength({ time: true, next: true, orb: true, wave: true }, true)).toBe(64 + 58 + 84 + 34 + 76)
    expect(dockLength({ ...none, next: true, wave: true, orb: true }, false)).toBe(174)
  })
  it('sizes the shell for the panel, the docked pill and the pill with its note', () => {
    const base = { expanded: false, panelH: 400, noteOpen: false, dockLen: 200, pillW: 384, pillH: 70 }
    expect(islandSize({ ...base, expanded: true, dock: 'top' })).toEqual({ w: ISLAND_PANEL_WIDTH, h: 400 })
    expect(islandSize({ ...base, dock: 'left' })).toEqual({ w: DOCK_SIDE.w, h: 200 })
    expect(islandSize({ ...base, dock: 'bottom' })).toEqual({ w: 200, h: DOCK_STRIP.h })
    expect(islandSize({ ...base, dock: 'top', noteOpen: true })).toEqual({ w: NOTE_W, h: 70 + NOTE_H })
    expect(islandSize(base)).toEqual({ w: 384, h: 70 })
  })
  it('stands on the pill centre at a side edge, inside the window', () => {
    expect(shellTopAt(false, 300, 100)).toBe(0)
    expect(shellTopAt(true, 300, 100)).toBe(250)
    expect(shellTopAt(true, 10, 100)).toBe(0)
    expect(shellTopAt(true, ISLAND_WINDOW.height, 100)).toBe(ISLAND_WINDOW.height - 100)
  })
})

describe('islandAxis', () => {
  const ticks = { step: H, list: [t('09:00'), t('10:00'), t('11:00'), t('12:00'), t('13:00')] }
  it('drops ticks next to now and to schedule marks', () => {
    const a = islandAxis({ from: t('09:00'), to: t('13:00'), now: t('11:00'), schedule: { work: [t('09:00'), t('18:00')] }, ticks })
    expect(a.marks.map((m) => m.text)).toEqual(['Начало 09:00'])
    expect(a.list).toEqual([t('10:00'), t('12:00'), t('13:00')])
    expect(a.all).toBe(ticks.list)
    expect(a.minor).toContain(t('09:15'))
  })
  it('labels lunch at its start and drops a mark close to now', () => {
    const a = islandAxis({ from: t('09:00'), to: t('13:00'), now: t('12:50'), schedule: { lunch: [t('10:00'), t('11:00')], work: [t('12:40'), t('18:00')] }, ticks })
    expect(a.marks).toEqual([{ t: t('10:00'), text: 'Обед', cls: 'lunch' }])
  })
})

describe('cutPlace', () => {
  const now = t('12:00')
  const active = { start: t('10:00'), end: t('11:00') }
  it('takes the active period without a line', () => {
    expect(cutPlace({ title: 'work', hasMarker: true, active, now, today: DAY })).toEqual({ day: DAY, range: active, text: 'work' })
  })
  it('reads a leading duration without a marker', () => {
    expect(cutPlace({ title: '30м отчёт', hasMarker: false, active, now, today: DAY })).toEqual({ day: DAY, range: { start: now - 30 * M, end: now }, text: 'отчёт' })
    expect(cutPlace({ title: '30м отчёт', hasMarker: true, active, now, today: DAY }).range).toEqual(active)
  })
  it('follows the line: a named time on its day, a duration back from now', () => {
    expect(cutPlace({ title: 'x', q: quick({ start: t('14:00', NEXT), day: NEXT }), hasMarker: false, active, now, today: DAY })).toEqual({ day: NEXT, range: { start: t('14:00', NEXT), end: t('14:30', NEXT) }, text: 'x' })
    expect(cutPlace({ title: 'x', q: quick({ dur: 15 * M }), hasMarker: false, active, now, today: DAY }).range).toEqual({ start: now - 15 * M, end: now })
    expect(cutPlace({ title: 'x', q: quick({ dur: 15 * M }), hasMarker: true, active, now, today: DAY }).range).toEqual(active)
  })
  it('moves the range to another day the line names', () => {
    expect(cutPlace({ title: 'x', q: quick({ day: NEXT }), hasMarker: true, active, now, today: DAY })).toEqual({ day: NEXT, range: { start: t('10:00', NEXT), end: t('11:00', NEXT) }, text: 'x' })
  })
  it('has nothing to cut without a period', () => {
    expect(cutPlace({ title: 'x', hasMarker: false, now, today: DAY }).range).toBeUndefined()
  })
})

describe('quickEventPlace', () => {
  const now = t('12:00') + 25_000
  it('counts minutes back or forward from the current minute', () => {
    expect(quickEventPlace({ offsetMin: -30, now, today: DAY })).toEqual({ day: DAY, start: t('11:30'), end: t('12:00') })
    expect(quickEventPlace({ offsetMin: 45, now, today: DAY })).toEqual({ day: DAY, start: t('12:00'), end: t('12:45') })
  })
  it('lets the line name the duration, the time or the day', () => {
    expect(quickEventPlace({ q: quick({ dur: 10 * M }), offsetMin: 45, now, today: DAY })).toEqual({ day: DAY, start: t('11:50'), end: t('12:00') })
    expect(quickEventPlace({ q: quick({ start: t('09:00'), end: t('09:20') }), offsetMin: -30, now, today: DAY })).toEqual({ day: DAY, start: t('09:00'), end: t('09:20') })
    expect(quickEventPlace({ q: quick({ day: NEXT }), offsetMin: -30, now, today: DAY })).toEqual({ day: NEXT, start: t('11:30', NEXT), end: t('12:00', NEXT) })
  })
})

describe('dayListRows', () => {
  it('lists blocks in time order, each followed by its notes; other notes by time', () => {
    const rows = dayListRows([entry('b', '11:00', '12:00'), entry('a', '09:00', '10:00')], [note('n3', '13:00'), note('n1', '08:00'), note('n2', '09:30'), note('x', '09:40', '')])
    expect(rows.map((r) => (r.type === 'entry' ? r.e.id : `${r.n.id}${r.owned ? '+' : ''}`))).toEqual(['n1', 'a', 'n2+', 'b', 'n3'])
  })
  it('orders blocks starting together by lane', () => {
    const rows = dayListRows([entry('b', '09:00', '10:00', { lane: 1 }), entry('a', '09:00', '10:00', { lane: 0 })], [])
    expect(rows.map((r) => (r.type === 'entry' ? r.e.id : ''))).toEqual(['a', 'b'])
  })
})
