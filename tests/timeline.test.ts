import { describe, expect, it } from 'vitest'
import { isCallApp } from '../src/shared/apps'
import { atTime, cutCursor, formatDuration, overlapPairs, placeEntry, splitByDay, subtractRanges } from '../src/shared/timeline'
import type { Entry } from '../src/shared/types'

const DAY = '2026-10-12' // Monday
const t = (hm: string) => atTime(DAY, hm)
let n = 0
const id = () => `id${++n}`
const entry = (start: string, end: string, extra: Partial<Entry> = {}): Entry => ({
  id: id(),
  start: t(start),
  end: t(end),
 
  kind: 'task',
  label: 'x',
  source: 'manual',
  ...extra,
})

describe('cutCursor', () => {
  it('now when nothing is labelled', () => {
    expect(cutCursor([], t('10:00'))).toBe(t('10:00'))
  })
  it('continues after the latest entry, parallel ones included', () => {
    const entries = [entry('08:50', '10:00'), entry('10:30', '11:00', { lane: 1 })]
    expect(cutCursor(entries, t('11:30'))).toBe(t('11:00'))
  })
  it('a planned block (later today) does not count; a block running now — up to now', () => {
    expect(cutCursor([entry('08:50', '11:00'), entry('15:00', '16:00')], t('14:00'))).toBe(t('11:00'))
    expect(cutCursor([entry('13:00', '15:00')], t('14:00'))).toBe(t('14:00'))
  })
})

describe('overlapPairs', () => {
  it('finds the common stretch of blocks running at once', () => {
    const a = entry('09:00', '10:00')
    const b = entry('09:40', '11:00', { lane: 1 })
    const c = entry('11:00', '12:00')
    const out = overlapPairs([c, b, a])
    expect(out.length).toBe(1)
    expect([out[0].a.id, out[0].b.id, out[0].end - out[0].start]).toEqual([a.id, b.id, 20 * 60_000])
  })
})

describe('placeEntry', () => {
  it('trims and splits overlapping main-line entries', () => {
    const big = entry('09:00', '12:00', { label: 'task' })
    const out = placeEntry([big], entry('10:00', '10:30', { label: 'call' }), id)
    expect(out.map((e) => [e.label, e.start, e.end])).toEqual([
      ['task', t('09:00'), t('10:00')],
      ['call', t('10:00'), t('10:30')],
      ['task', t('10:30'), t('12:00')],
    ])
    // the tail got a fresh id, the head kept the original
    expect(out[0].id).toBe(big.id)
    expect(out[2].id).not.toBe(big.id)
  })

  it('moves old nested entries to a free parallel lane', async () => {
    const { unnest } = await import('../src/shared/timeline')
    const main = { ...entry('09:00', '12:00'), level: 0 }
    const call = { ...entry('10:00', '10:30', { kind: 'call' }), level: 1 }
    const r = unnest([main, call])
    expect(r.changed).toBe(true)
    expect(r.entries.every((e) => !('level' in e))).toBe(true)
    expect(r.entries.find((e) => e.id === main.id)).toMatchObject({ start: t('09:00'), end: t('12:00'), lane: 0 })
    expect(r.entries.find((e) => e.id === call.id)?.lane).toBe(1)
    expect(unnest(r.entries).changed).toBe(false)
  })

  it('replaces an entry with the same id on edit', () => {
    const e = entry('09:00', '10:00')
    const out = placeEntry([e], { ...e, end: t('10:15') }, id)
    expect(out).toHaveLength(1)
    expect(out[0].end).toBe(t('10:15'))
  })
})

describe('time helpers', () => {
  it('splits at local midnight', () => {
    const parts = splitByDay(atTime(DAY, '23:30'), atTime('2026-10-13', '00:20'))
    expect(parts.map((p) => p[0])).toEqual([DAY, '2026-10-13'])
    expect(parts[0][2]).toBe(atTime('2026-10-13', '00:00'))
  })

  it('subtracts ranges', () => {
    expect(subtractRanges(t('09:00'), t('12:00'), [{ start: t('10:00'), end: t('11:00') }])).toEqual([
      [t('09:00'), t('10:00')],
      [t('11:00'), t('12:00')],
    ])
  })

  it('formats durations', () => {
    expect(formatDuration(65 * 60_000)).toBe('1ч 05м')
    expect(formatDuration(5 * 60_000)).toBe('5м')
  })
})

describe('call apps', () => {
  it('recognises call apps holding the microphone', () => {
    expect(isCallApp('MSTeams_8wekyb3d8bbwe')).toBe('Teams')
    expect(isCallApp('Zoom.exe')).toBe('Zoom')
    expect(isCallApp('SoundRecorder.exe')).toBeUndefined()
  })
})

describe('flattenForDisplay / parseQuickDuration', () => {
  it('puts overlapping blocks on parallel lanes', async () => {
    const { flattenForDisplay } = await import('../src/shared/timeline')
    const main = entry('09:00', '11:00', { label: 'task' })
    const call = entry('10:00', '10:30', { kind: 'call', label: 'call' })
    const segs = flattenForDisplay([main, call])
    expect(segs.map((s) => [s.entry.label, s.start, s.end, s.lane])).toEqual([
      ['task', t('09:00'), t('11:00'), 0],
      ['call', t('10:00'), t('10:30'), 1],
    ])
  })

  it('parses quick durations', async () => {
    const { parseQuickDuration } = await import('../src/shared/timeline')
    expect(parseQuickDuration('30м созвон с командой')).toEqual({ minutes: 30, rest: 'созвон с командой' })
    expect(parseQuickDuration('1ч ревью')).toEqual({ minutes: 60, rest: 'ревью' })
    expect(parseQuickDuration('20 мин')).toEqual({ minutes: 20, rest: '' })
    expect(parseQuickDuration('ABC-1 fix')).toBeUndefined()
    expect(parseQuickDuration('3мя людьми')).toBeUndefined()
  })
})

describe('parallel entries', () => {
  it('stacks overlapping main-line entries into lanes', async () => {
    const { layoutLanes } = await import('../src/shared/timeline')
    const a = entry('09:00', '10:00')
    const b = entry('09:30', '10:30')
    const c = entry('11:00', '12:00')
    const l = layoutLanes([a, b, c])
    expect(l.get(a.id)).toEqual({ lane: 0, lanes: 2 })
    expect(l.get(b.id)).toEqual({ lane: 1, lanes: 2 })
    expect(l.get(c.id)).toEqual({ lane: 0, lanes: 2 })
  })

  it('merges into the earliest entry and keeps the rest in parallel', async () => {
    const { mergeEntries } = await import('../src/shared/timeline')
    const a = entry('09:00', '09:30', { label: 'A' })
    const mid = entry('09:30', '10:00', { label: 'mid' })
    const b = entry('10:00', '10:30', { label: 'B' })
    const r = mergeEntries([a, mid, b], [b.id, a.id])!
    expect(r.merged).toMatchObject({ id: a.id, label: 'A', start: t('09:00'), end: t('10:30') })
    expect(r.removed).toEqual([b.id])
  })

  it('counts parallel time once', async () => {
    const { unionMs } = await import('../src/shared/timeline')
    expect(unionMs([entry('09:00', '10:00'), entry('09:30', '10:30')])).toBe(90 * 60_000)
  })
})

describe('stored lanes', () => {
  it('keeps a block on its stored lane even when the main lane is free', async () => {
    const { layoutLanes } = await import('../src/shared/timeline')
    const top = entry('09:00', '10:00')
    const low = entry('11:00', '12:00', { lane: 1 })
    expect(layoutLanes([top, low]).get(low.id)?.lane).toBe(1)
  })

  it('a dragged block yields — the others never jump lanes', async () => {
    const { layoutLanes } = await import('../src/shared/timeline')
    const top = entry('09:00', '10:00')
    const dragged = entry('09:00', '10:00', { lane: 0 }) // same start as the top one while dragging
    const l = layoutLanes([top, dragged], dragged.id)
    expect(l.get(top.id)?.lane).toBe(0)
    expect(l.get(dragged.id)?.lane).toBe(1)
  })

  it('finds free lanes', async () => {
    const { firstFreeLane, laneIsFree } = await import('../src/shared/timeline')
    const a = entry('09:00', '10:00')
    const b = entry('09:30', '10:30', { lane: 1 })
    expect(laneIsFree([a, b], 0, t('10:00'), t('11:00'))).toBe(true)
    expect(laneIsFree([a, b], 1, t('10:00'), t('11:00'))).toBe(false)
    expect(firstFreeLane([a, b], t('09:15'), t('09:45'))).toBe(2)
  })
})

describe('pinLanes', () => {
  it('freezes the layout so a re-layout without yielding is identical', async () => {
    const { layoutLanes, pinLanes } = await import('../src/shared/timeline')
    const old = entry('09:00', '10:00') // legacy, no lane
    const moved = entry('09:00', '09:30', { lane: 0 })
    const pinned = pinLanes([old, moved], moved.id)
    const again = layoutLanes(pinned)
    expect(again.get(old.id)?.lane).toBe(0)
    expect(again.get(moved.id)?.lane).toBe(1)
  })
})

describe('productivity', () => {
  it('excludes breaks and lunch, counts parallel time once', async () => {
    const { DEFAULT_KINDS, productiveMs, workDayMs } = await import('../src/shared/kinds')
    const list = [entry('09:00', '10:00'), entry('09:30', '10:30'), entry('12:00', '13:00', { kind: 'lunch' }), entry('15:00', '15:15', { kind: 'break' })]
    expect(productiveMs(list, DEFAULT_KINDS)).toBe(90 * 60_000)
    expect(workDayMs(DAY, { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00', workDays: [1] }, 1)).toBe(8 * 3600_000)
  })

  it('respects the productive flag from settings', async () => {
    const { isProductive } = await import('../src/shared/kinds')
    expect(isProductive([{ id: 'break', label: 'x', color: '', icon: '', productive: true }], 'break')).toBe(true)
    expect(isProductive([], 'lunch')).toBe(false)
    expect(isProductive([], 'custom')).toBe(true)
  })
})

describe('productive split', () => {
  it('counts only work hours without lunch; the rest is over time', async () => {
    const { DEFAULT_KINDS, productiveSplit, unlabelledMs } = await import('../src/shared/kinds')
    const list = [entry('08:00', '10:00'), entry('12:30', '13:30'), entry('18:00', '19:00')]
    const r = productiveSplit(list, DEFAULT_KINDS, [t('09:00'), t('18:00')], [t('13:00'), t('14:00')])
    expect(r.within).toBe(90 * 60_000) // 09–10 + 12:30–13
    expect(r.over).toBe(r.total - r.within)
    expect(productiveSplit(list, DEFAULT_KINDS).over).toBe(r.total) // day off
    expect(unlabelledMs([entry('09:00', '10:00')], [{ start: t('09:00'), end: t('11:00') }])).toBe(60 * 60_000)
  })
})
