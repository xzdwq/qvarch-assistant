import { describe, expect, it } from 'vitest'
import { placeSlot, workDay } from '../src/shared/work'
import type { Entry } from '../src/shared/types'

const D = '2026-10-16'
const t = (hm: string) => new Date(`${D}T${hm}:00`).getTime()
const M = 60_000
let n = 0
const e = (a: string, b: string, x: Partial<Entry> = {}): Entry => ({ id: `e${++n}`, start: t(a), end: t(b), kind: 'task', label: 'x', source: 'manual', ...x })
const opts = (now: string, isToday = true) => ({ now: t(now), isToday, dayStart: t('00:00'), dayEnd: t('23:59'), workStart: t('09:00') })

describe('workDay', () => {
  it('the day list keeps its order; a meeting given a task counts in it; the rest sorts out', () => {
    const w = workDay({
      dayTasks: [{ key: 'Q-2', summary: 'Своя' }, { key: 'DOS-1', summary: 'Jira' }],
      entries: [
        e('09:00', '10:00', { task: { key: 'DOS-1', summary: 'Jira' } }),
        e('10:00', '10:30', { kind: 'meeting', outlook: { id: 'o', sig: 's' }, task: { key: 'DOS-1', summary: 'Jira' } }),
        e('11:00', '11:20', { kind: 'call' }),
        e('12:00', '13:00', { kind: 'lunch' }),
        e('14:00', '15:00', { task: { key: 'RND-5', summary: 'Ещё' } }),
      ],
    })
    expect(w.tasks.map((x) => x.task.key)).toEqual(['Q-2', 'DOS-1', 'RND-5'])
    expect(w.tasks[0].own).toBe(true)
    expect(w.tasks[1].ms).toBe(90 * M)
    expect(w.meetings).toHaveLength(1)
    expect(w.calls).toHaveLength(1)
    expect(w.other.map((x) => x.kind)).toEqual(['lunch'])
    expect(w.totals.tasks).toBe(150 * M)
    expect(w.totals.all).toBe(230 * M)
  })
})

describe('placeSlot', () => {
  it('today: the latest free stretch before now that fits', () => {
    const list = [e('09:00', '10:00'), e('10:20', '11:50')]
    // 11:50–12:00 is too short for 30 min; 10:00–10:20 too; before 09:00 fits
    expect(placeSlot(list, 30 * M, opts('12:00'))).toEqual({ start: t('08:30'), end: t('09:00') })
    expect(placeSlot(list, 10 * M, opts('12:00'))).toEqual({ start: t('11:50'), end: t('12:00') })
  })
  it('today: a block running now is busy; nothing free before — after the last block', () => {
    const list = [e('00:00', '13:00'), e('13:00', '15:00')]
    expect(placeSlot(list, 30 * M, opts('14:00'))).toEqual({ start: t('15:00'), end: t('15:30') })
  })
  it('another day: after the last block, or at the work start', () => {
    expect(placeSlot([e('09:00', '10:00')], 60 * M, opts('12:00', false))).toEqual({ start: t('10:00'), end: t('11:00') })
    expect(placeSlot([], 60 * M, opts('12:00', false))).toEqual({ start: t('09:00'), end: t('10:00') })
  })
})
