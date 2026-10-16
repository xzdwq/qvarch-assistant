import { describe, expect, it } from 'vitest'
import { keyTotals, nextTaskKey } from '../src/shared/board'
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
