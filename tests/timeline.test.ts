import { describe, expect, it } from 'vitest'
import { classifyApp, isCallApp, pushSample } from '../src/shared/apps'
import { atTime, cutCursor, fillFromActivity, formatDuration, overlapPairs, placeEntry, splitByDay, subtractRanges, trackedMs, uncutMs } from '../src/shared/timeline'
import type { ActivitySegment, Entry } from '../src/shared/types'

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
  const spans = [
    { start: t('08:50'), end: t('12:00') },
    { start: t('13:10'), end: t('18:00') },
  ]

  it('starts at the first span when nothing is labelled', () => {
    expect(cutCursor([], spans, t('10:00'))).toBe(t('08:50'))
  })

  it('continues after the latest entry, parallel ones included', () => {
    const entries = [entry('08:50', '10:00'), entry('10:30', '11:00', { lane: 1 })]
    expect(cutCursor(entries, spans, t('11:30'))).toBe(t('11:00'))
  })

  it('stays at the block over an off-period; "не размечено" is all the time since it', () => {
    expect(cutCursor([entry('08:50', '11:00')], spans, t('14:00'))).toBe(t('11:00'))
    expect(uncutMs(t('11:00'), t('14:00'))).toBe(180 * 60_000)
  })

  it('stays right after the block when QA paused only briefly (a restart)', () => {
    const short = [
      { start: t('08:50'), end: t('10:02') },
      { start: t('10:06'), end: t('18:00') },
    ]
    // the block ends inside the 4-minute pause: no gap between it and "не размечено"
    expect(cutCursor([entry('09:00', '10:04')], short, t('12:00'))).toBe(t('10:04'))
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
  it('counts only time the PC was on', () => {
    expect(trackedMs(t('11:00'), t('14:00'), [{ start: t('09:00'), end: t('12:00') }, { start: t('13:00'), end: t('18:00') }])).toBe(2 * 3600_000)
  })

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

describe('apps', () => {
  it('classifies common processes', () => {
    expect(classifyApp('Code')).toEqual({ name: 'VS Code', kind: 'ide' })
    expect(classifyApp('ms-teams')).toEqual({ name: 'Teams', kind: 'teams' })
    expect(classifyApp('OUTLOOK.EXE')).toEqual({ name: 'Outlook', kind: 'mail' })
    expect(classifyApp('olk')).toEqual({ name: 'Outlook', kind: 'mail' })
  })

  it('recognises call apps holding the microphone', () => {
    expect(isCallApp('MSTeams_8wekyb3d8bbwe')).toBe('Teams')
    expect(isCallApp('Zoom.exe')).toBe('Zoom')
    expect(isCallApp('SoundRecorder.exe')).toBeUndefined()
  })

  it('merges consecutive samples of the same app and opens a new segment on switch', () => {
    const list: ActivitySegment[] = []
    pushSample(list, { t: 0, app: 'VS Code', kind: 'ide' }, 10_000)
    pushSample(list, { t: 2000, app: 'VS Code', kind: 'ide' }, 10_000)
    pushSample(list, { t: 4000, app: 'Chrome', kind: 'browser' }, 10_000)
    pushSample(list, { t: 60_000, app: 'Chrome', kind: 'browser' }, 10_000)
    expect(list.map((s) => [s.app, s.start, s.end])).toEqual([
      ['VS Code', 0, 2000],
      ['Chrome', 2000, 4000],
      ['Chrome', 60_000, 60_000],
    ])
    // without title capture only apps are stored
    expect(list.some((s) => 'title' in s)).toBe(false)
    // with it, a new title starts a new segment
    pushSample(list, { t: 62_000, app: 'Chrome', kind: 'browser', title: 'Docs' }, 10_000)
    expect(list[list.length - 1]).toMatchObject({ app: 'Chrome', title: 'Docs', start: 60_000 })
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
    expect(parseQuickDuration('DOS-1 fix')).toBeUndefined()
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

describe('fillFromActivity', () => {
  it('gives back the time the app ran but the span did not grow', () => {
    const spans = [{ start: t('09:00'), end: t('10:00') }, { start: t('11:47'), end: t('11:47') }]
    const activity = [{ start: t('11:47'), end: t('12:00') }, { start: t('12:00'), end: t('12:14') }]
    expect(fillFromActivity(spans, activity)).toEqual([{ start: t('09:00'), end: t('10:00') }, { start: t('11:47'), end: t('12:14') }])
    expect(fillFromActivity([{ start: t('09:00'), end: t('12:14') }], activity)).toBeUndefined()
  })
})
