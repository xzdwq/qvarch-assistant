import { describe, expect, it } from 'vitest'
import { keyTotals, nextTaskKey } from '../src/shared/board'
import { closestPair, cornerAnchors, linkPath } from '../src/shared/linkpath'
import type { Entry } from '../src/shared/types'

const t = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime()
const e = (id: string, day: string, a: string, b: string, p: Partial<Entry> = {}): Entry => ({ id, start: t(day, a), end: t(day, b), kind: 'task', label: 'dev', source: 'manual', ...p })

describe('tasks across days', () => {
  const days = [
    { entries: [e('a', '2026-10-08', '09:00', '10:00', { task: { key: 'Q-3', summary: 'x' } })] },
    // the same task taken again the next day, with a parallel block of it — counted once
    { entries: [e('b', '2026-10-09', '09:00', '09:30', { task: { key: 'Q-3', summary: 'x' } }), e('b2', '2026-10-09', '09:15', '09:45', { task: { key: 'Q-3', summary: 'x' }, lane: 1 })] },
  ]
  it('one task over the days: time summed, parallel blocks counted once', () => {
    expect(keyTotals(days)['Q-3']).toBe(60 * 60_000 + 45 * 60_000)
  })
  it('own task numbers never go back', () => {
    expect(nextTaskKey([{ key: 'Q-2' }, { key: 'Q-7' }])).toBe('Q-8')
    expect(nextTaskKey([{ key: 'Q-2' }], 9)).toBe('Q-10')
  })
})

describe('link geometry', () => {
  it('takes the closest corners: right-bottom of the upper-left block, left-top of the lower-right one', () => {
    const a = cornerAnchors({ left: 0, top: 0, right: 100, bottom: 30 })
    const b = cornerAnchors({ left: 200, top: 60, right: 300, bottom: 90 })
    const [pa, pb] = closestPair(a, b)!
    expect([pa.x, pa.dir]).toEqual([92, 1])
    expect([pb.x, pb.dir]).toEqual([208, -1])
  })
  it('draws every style', () => {
    const a = { x: 0, y: 0, dir: 1 as const }
    const b = { x: 100, y: 50, dir: -1 as const }
    expect(linkPath(a, b, 'straight').d).toBe('M0,0 L100,50')
    expect(linkPath(a, b, 'elbow').d).toBe('M0,0 V25 H100 V50')
    expect(linkPath(a, b, 'curve').d.startsWith('M0,0 C')).toBe(true)
    expect(linkPath(a, b, 'rounded').d).toContain('Q')
  })
  it('side anchors run in the gap beside the blocks', async () => {
    const { sideAnchors } = await import('../src/shared/linkpath')
    const upper = sideAnchors({ left: 0, top: 0, right: 100, bottom: 40 })
    const lower = sideAnchors({ left: 0, top: 100, right: 100, bottom: 140 })
    const [pa, pb] = closestPair(upper, lower)!
    expect([pa.h, pb.h]).toEqual([true, true])
    expect(linkPath(pa, pb, 'elbow').d).toMatch(/^M0,30 H-8 V110 H0$/)
  })
})
