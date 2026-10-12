import { describe, expect, it } from 'vitest'
import { breakdown, gapAround, infoAt } from '../src/shared/breakdown'
import { atTime } from '../src/shared/timeline'
import type { CallSegment, DayData } from '../src/shared/types'

const DAY = '2026-10-12'
const t = (hm: string) => atTime(DAY, hm)

const day: DayData = {
  day: DAY,
  notes: [],
  spans: [
    { start: t('09:00'), end: t('12:00') },
    { start: t('13:00'), end: t('15:00'), open: true },
  ],
  activity: [
    { start: t('09:00'), end: t('10:00'), app: 'VS Code', kind: 'ide', title: 'a.ts' },
    { start: t('10:00'), end: t('10:30'), app: 'Простой', kind: 'idle' },
    { start: t('10:30'), end: t('11:00'), app: 'Chrome', kind: 'browser', title: 'DOS-1 page' },
    { start: t('11:00'), end: t('11:30'), app: 'VS Code', kind: 'ide', title: 'b.ts' },
  ],
  calls: [{ start: t('10:40'), end: t('10:50'), app: 'Teams', source: 'mic' }],
  entries: [
    { id: 'e1', start: t('09:00'), end: t('10:00'), kind: 'task', label: 'dev', source: 'manual' },
    { id: 'e2', start: t('11:00'), end: t('11:30'), kind: 'task', label: 'dev', source: 'manual' },
  ],
}

describe('breakdown', () => {
  it('aggregates apps, titles, idle and calls inside the range', () => {
    const b = breakdown(day, t('09:00'), t('12:00'))
    expect(b.apps.map((a) => [a.app, a.ms / 60_000])).toEqual([
      ['VS Code', 90],
      ['Простой', 30],
      ['Chrome', 30],
    ])
    expect(b.idleMs).toBe(30 * 60_000)
    expect(b.activeMs).toBe(120 * 60_000)
    expect(b.callsMs).toBe(10 * 60_000)
    expect(b.titles[0]).toMatchObject({ title: 'a.ts', ms: 60 * 60_000 })
  })

  it('clips to the range', () => {
    const b = breakdown(day, t('09:30'), t('10:15'))
    expect(b.apps.find((a) => a.app === 'VS Code')?.ms).toBe(30 * 60_000)
    expect(b.entries.map((e) => e.id)).toEqual(['e1'])
  })
})

describe('gapAround', () => {
  it('selects the unlabelled gap between entries', () => {
    expect(gapAround(day, t('10:20'), t('15:00'))).toEqual({ start: t('10:00'), end: t('11:00') })
  })

  it('stops at the end of a closed span', () => {
    expect(gapAround(day, t('11:45'), t('15:00'))).toEqual({ start: t('11:30'), end: t('12:00') })
  })

  it('treats an off-period (PC asleep) as its own gap', () => {
    expect(gapAround(day, t('12:30'), t('15:00'))).toEqual({ start: t('12:00'), end: t('13:00') })
  })

  it('runs to the limit (now) inside the open span', () => {
    expect(gapAround(day, t('14:00'), t('14:30'))).toEqual({ start: t('13:00'), end: t('14:30') })
  })
})

describe('infoAt', () => {
  it('describes a moment', () => {
    const i = infoAt(day, t('10:45'))
    expect(i.pcOn).toBe(true)
    expect(i.activity?.app).toBe('Chrome')
    expect(i.call?.app).toBe('Teams')
    expect(i.entry).toBeUndefined()
  })
})

describe('detected calls → blocks', () => {
  it('creates a block on a free lane, extends it, never re-creates a deleted one', async () => {
    const { syncCallEntry } = await import('../src/shared/calls')
    const { DEFAULT_KINDS } = await import('../src/shared/kinds')
    const d: DayData = {
      day: DAY,
      notes: [],
      spans: [],
      activity: [],
      calls: [],
      entries: [{ id: 'busy', start: t('10:00'), end: t('11:00'), kind: 'task', label: 'dev', source: 'manual', lane: 0 }],
    }
    let n = 0
    const call: CallSegment = { start: t('10:20'), end: t('10:20') + 5_000, app: 'Teams', source: 'mic' }
    expect(syncCallEntry(d, call, DEFAULT_KINDS, () => `c${++n}`)).toBe(false) // too short yet
    call.end = t('10:40')
    expect(syncCallEntry(d, call, DEFAULT_KINDS, () => `c${++n}`)).toBe(true)
    const e = d.entries.find((x) => x.id === call.entryId)!
    expect(e).toMatchObject({ kind: 'call', label: 'Созвон Teams', lane: 1, source: 'detected' })
    call.end = t('10:50')
    syncCallEntry(d, call, DEFAULT_KINDS, () => `c${++n}`)
    expect(e.end).toBe(t('10:50'))
    d.entries = d.entries.filter((x) => x.id !== e.id) // user deleted it
    call.end = t('11:00')
    expect(syncCallEntry(d, call, DEFAULT_KINDS, () => `c${++n}`)).toBe(false)
    expect(d.entries).toHaveLength(1)
  })
})

describe('notes', () => {
  it('belong to the most specific block running at their moment', async () => {
    const { noteEntry, visibleNotes } = await import('../src/shared/notes')
    const task = { id: 't', start: t('10:00'), end: t('12:00'), kind: 'task', label: '', source: 'manual' as const }
    const call = { id: 'c', start: t('10:30'), end: t('11:00'), kind: 'call', label: '', source: 'manual' as const }
    expect(noteEntry({ at: t('10:40') }, [task, call])?.id).toBe('c')
    expect(noteEntry({ at: t('11:30') }, [task, call])?.id).toBe('t')
    expect(noteEntry({ at: t('12:30') }, [task, call])).toBeUndefined()
    const notes = [
      { id: 'b', at: t('11:00'), text: 'b', updatedAt: 0 },
      { id: 'e', at: t('09:00'), text: '  ', updatedAt: 0 },
      { id: 'a', at: t('10:00'), text: 'a', updatedAt: 0 },
    ]
    expect(visibleNotes(notes).map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('typing combo', () => {
  it('counts presses less than 3 s apart, restarts after a pause, keeps the best', async () => {
    const { emptyCombo, pushKeys } = await import('../src/shared/combo')
    const c = emptyCombo()
    expect(pushKeys(c, [1000, 2000, 4500, 7400])).toBe(true)
    expect(c.current).toBe(4)
    // a pause longer than 3 s starts from zero; the best stays
    expect(pushKeys(c, [10_500, 11_000])).toBe(false)
    expect(c.current).toBe(2)
    expect(c.best).toBe(4)
    expect(c.bestAt).toBe(7400)
  })
})

describe('activity pulse', () => {
  it('sums input into minute bins and draws a smooth path', async () => {
    const { addToRows, pulseScore, smoothPath } = await import('../src/shared/pulse')
    const rows: Array<[number, number, number, number]> = []
    const d0 = t('00:00')
    addToRows(rows, d0, t('10:00') + 5_000, 3, 120.4, 0)
    addToRows(rows, d0, t('10:00') + 50_000, 2, 30, 1)
    addToRows(rows, d0, t('10:01') + 1_000, 1, 0, 0)
    expect(rows).toEqual([
      [600, 5, 150, 1],
      [601, 1, 0, 0],
    ])
    expect(pulseScore({ k: 2, m: 300, s: 1 })).toBe(7)
    expect(smoothPath([[0, 10], [50, 0], [100, 10]])).toMatch(/^M0\.0,10\.0 C/)
  })
})

describe('title + description', () => {
  it('splits the first line off as the title', async () => {
    const { joinTitle, splitTitle } = await import('../src/shared/timeline')
    expect(splitTitle('Ревью PR\nпроверил миграции\n  и тесты ')).toEqual({ label: 'Ревью PR', description: 'проверил миграции\n  и тесты' })
    expect(splitTitle(' только название ')).toEqual({ label: 'только название', description: undefined })
    expect(joinTitle('A', 'b')).toBe('A\nb')
    expect(joinTitle('A')).toBe('A')
  })
})

describe('jira helpers', () => {
  it('takes project keys from board links and plain keys', async () => {
    const { projectKeys } = await import('../src/shared/jira')
    expect(
      projectKeys('https://aoavant.atlassian.net/jira/software/c/projects/DOS/boards/98, rnd https://aoavant.atlassian.net/jira/software/c/projects/AI/boards/7532 DOS'),
    ).toEqual(['DOS', 'RND', 'AI'])
  })
  it('offers my open tasks and the starred ones, nearest due first', async () => {
    const { pickableTasks } = await import('../src/shared/jira')
    const base = { status: '', project: { key: 'DOS', name: '' }, type: '', updated: 0 }
    const issues = [
      { ...base, key: 'DOS-1', summary: 'a', category: 'new' as const, mine: true, due: '2026-10-20' },
      { ...base, key: 'DOS-2', summary: 'b', category: 'done' as const, mine: true },
      { ...base, key: 'DOS-3', summary: 'c', category: 'new' as const, mine: false },
      { ...base, key: 'DOS-4', summary: 'd', category: 'indeterminate' as const, mine: false, due: '2026-10-12' },
      { ...base, key: 'DOS-5', summary: 'e', category: 'new' as const, mine: true },
    ]
    const keys = pickableTasks({ issues, starred: ['DOS-4'], myStatus: { 'DOS-5': 'done' } }).map((i) => i.key)
    expect(keys).toEqual(['DOS-4', 'DOS-1'])
  })
})

describe('AI day model', () => {
  it('is compact: apps folded into totals and half-hour slots, titles only when allowed', async () => {
    const { buildDayModel } = await import('../src/shared/aimodel')
    const { DEFAULT_KINDS } = await import('../src/shared/kinds')
    const schedule = { start: '09:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00', workDays: [1, 2, 3, 4, 5] }
    // many tiny window switches between two apps
    const activity = []
    for (let t = t0(); t < t0() + 60 * 60_000; t += 30_000)
      activity.push({ start: t, end: t + 30_000, app: (t / 30_000) % 2 ? 'VS Code' : 'Browser', kind: 'ide' as const, title: 'secret.txt' })
    function t0() {
      return t('10:00')
    }
    const d: DayData = {
      day: DAY,
      spans: [{ start: t('09:30'), end: t('11:30') }],
      activity,
      calls: [],
      notes: [],
      entries: [{ id: 'e', start: t('10:00'), end: t('11:00'), kind: 'task', label: 'DOS-1 фича', source: 'manual', task: { key: 'DOS-1', summary: 'фича' } }],
    }
    const m = buildDayModel(d, { schedule, kinds: DEFAULT_KINDS }, t('12:00'))
    expect(m.apps.map((a) => a.app).sort()).toEqual(['Browser', 'VS Code'])
    expect(m.apps[0].sessions).toBe(60)
    expect(m.timeline).toHaveLength(2) // 10:00–10:30, 10:30–11:00
    expect(m.blocks[0]).toMatchObject({ from: '10:00', to: '11:00', min: 60, task: 'DOS-1 фича' })
    expect(JSON.stringify(m)).not.toContain('secret.txt')
    expect(JSON.stringify(buildDayModel(d, { schedule, kinds: DEFAULT_KINDS }, t('12:00'), true))).toContain('secret.txt')
    expect(JSON.stringify(m).length).toBeLessThan(3000)
  })
})

describe('day plan', () => {
  it('stacks overlapping plans into rows and snaps to 5 minutes', async () => {
    const { planRows, snapPlan, plannedWithin } = await import('../src/shared/plan')
    const p = (id: string, a: string, b: string) => ({ id, start: t(a), end: t(b), kind: 'task', label: id })
    const blocks = [p('a', '09:00', '10:00'), p('b', '09:30', '10:30'), p('c', '10:00', '11:00'), p('d', '10:15', '10:45')]
    const rows = planRows(blocks)
    expect([rows.get('a'), rows.get('b'), rows.get('c'), rows.get('d')]).toEqual([0, 1, 0, 2])
    expect(snapPlan(t('09:02'))).toBe(t('09:00'))
    expect(snapPlan(t('09:03'))).toBe(t('09:05'))
    expect(plannedWithin([p('a', '08:00', '10:00')], t('09:00'), t('18:00'))).toBe(60 * 60_000)
  })
})

describe('quick add range', () => {
  it('fills the latest free work time, else goes an hour forward, on a day off — the last hour', async () => {
    const { quickRange } = await import('../src/shared/timeline')
    const work: [number, number] = [t('09:00'), t('18:00')]
    const lunch: [number, number] = [t('13:00'), t('14:00')]
    const e = (a: string, b: string) => ({ id: a, start: t(a), end: t(b), kind: 'task', label: '', source: 'manual' as const })
    const hm = (r: { start: number; end: number }) => [new Date(r.start).toTimeString().slice(0, 5), new Date(r.end).toTimeString().slice(0, 5)]
    // labelled up to 11:00, now 11:40 → 11:00–11:40 (QA ran since midnight — not from 00:00)
    expect(hm(quickRange([e('09:00', '11:00')], work, lunch, t('11:40'), t('00:00')))).toEqual(['11:00', '11:40'])
    // lunch is not free time: labelled until 13:00, now 14:20 → 14:00–14:20
    expect(hm(quickRange([e('09:00', '13:00')], work, lunch, t('14:20'), t('00:00')))).toEqual(['14:00', '14:20'])
    // the day just started (09:02) → 09:00–10:00 forward
    expect(hm(quickRange([], work, lunch, t('09:02'), t('08:50')))).toEqual(['09:00', '10:00'])
    // before work → from the work start
    expect(hm(quickRange([], work, lunch, t('08:30'), t('08:00')))).toEqual(['09:00', '10:00'])
    // a free gap earlier in the day is used when the tail is labelled
    expect(hm(quickRange([e('09:00', '10:00'), e('10:30', '12:00')], work, lunch, t('12:00'), t('00:00')))).toEqual(['10:00', '10:30'])
    // day off: at most the last hour of the unlabelled tail
    expect(hm(quickRange([], undefined, undefined, t('09:30'), t('00:00')))).toEqual(['08:30', '09:30'])
  })
})
