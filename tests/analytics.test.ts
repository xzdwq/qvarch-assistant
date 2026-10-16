import { describe, expect, it } from 'vitest'
import { dailyByKind, eventsOf, heatOf, treemap } from '../src/shared/analytics'
import type { Entry } from '../src/shared/types'

const H = 3_600_000
const at = (day: string, h: number) => new Date(`${day}T00:00:00`).getTime() + h * H
const e = (day: string, a: number, b: number, extra: Partial<Entry> = {}) => ({
  day,
  e: { id: `${day}${a}`, start: at(day, a), end: at(day, b), kind: 'task', label: 'Ревью', source: 'manual', ...extra } as Entry,
})

describe('analytics', () => {
  it('events: a task by its key, others by kind + title; count, sum, average, days, per day', () => {
    const days = ['2026-10-12', '2026-10-13']
    const items = [
      e('2026-10-12', 9, 10, { task: { key: 'DOS-1', summary: 'Фича' }, label: 'x' }),
      e('2026-10-13', 9, 11, { task: { key: 'DOS-1', summary: 'Фича' }, label: 'y' }),
      e('2026-10-12', 12, 12.5, { label: ' ревью ' }),
      e('2026-10-13', 12, 12.5, { label: 'Ревью' }),
    ]
    const ev = eventsOf(items, days)
    expect(ev[0]).toMatchObject({ key: 'DOS-1', label: 'Фича', count: 2, ms: 3 * H, avg: 1.5 * H, days: 2, perDay: [H, 2 * H] })
    expect(ev[1]).toMatchObject({ key: 'task|ревью', count: 2, ms: H })
  })
  it('heat: weekday × hour, split at hour edges', () => {
    // 2026-10-12 is a Monday
    const m = heatOf([e('2026-10-12', 9.5, 11)])
    expect(m[0][9]).toBe(0.5 * H)
    expect(m[0][10]).toBe(H)
    expect(m[1].every((x) => x === 0)).toBe(true)
  })
  it('daily by kind: parallel blocks of one kind counted once', () => {
    const r = dailyByKind([e('2026-10-12', 9, 11), e('2026-10-12', 10, 12), e('2026-10-12', 13, 14, { kind: 'call' })], ['2026-10-12'])
    expect(r.kinds).toEqual(['task', 'call'])
    expect(r.rows[0]).toEqual({ task: 3 * H, call: H })
  })
  it('treemap: fills the box, areas follow the values', () => {
    const t = treemap([6, 6, 4, 3, 2, 2, 1], 600, 400)
    expect(t).toHaveLength(7)
    const area = t.reduce((s, x) => s + x.w * x.h, 0)
    expect(Math.round(area)).toBe(600 * 400)
    const a0 = t.find((x) => x.i === 0)!
    const a6 = t.find((x) => x.i === 6)!
    expect(Math.round((a0.w * a0.h) / (a6.w * a6.h))).toBe(6)
    expect(treemap([0, 0], 10, 10)).toEqual([])
  })
})
