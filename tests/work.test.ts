import { describe, expect, it } from 'vitest'
import { workDay } from '../src/shared/work'
import type { Entry } from '../src/shared/types'

const D = '2026-10-16'
const t = (hm: string) => new Date(`${D}T${hm}:00`).getTime()
const M = 60_000
let n = 0
const e = (a: string, b: string, x: Partial<Entry> = {}): Entry => ({ id: `e${++n}`, start: t(a), end: t(b), kind: 'task', label: 'x', source: 'manual', ...x })

describe('workDay', () => {
  it('the day list keeps its order; a meeting given a task counts in it; the rest sorts out', () => {
    const w = workDay({
      dayTasks: [{ key: 'Q-2', summary: 'Своя' }, { key: 'ABC-1', summary: 'Jira' }],
      entries: [
        e('09:00', '10:00', { task: { key: 'ABC-1', summary: 'Jira' } }),
        e('10:00', '10:30', { kind: 'meeting', outlook: { id: 'o', sig: 's' }, task: { key: 'ABC-1', summary: 'Jira' } }),
        e('11:00', '11:20', { kind: 'call' }),
        e('12:00', '13:00', { kind: 'lunch' }),
        e('14:00', '15:00', { task: { key: 'XYZ-5', summary: 'Ещё' } }),
      ],
    })
    expect(w.tasks.map((x) => x.task.key)).toEqual(['Q-2', 'ABC-1', 'XYZ-5'])
    expect(w.tasks[0].own).toBe(true)
    expect(w.tasks[1].ms).toBe(90 * M)
    expect(w.meetings).toHaveLength(1)
    expect(w.calls).toHaveLength(1)
    expect(w.other.map((x) => x.kind)).toEqual(['lunch'])
    expect(w.totals.tasks).toBe(150 * M)
    expect(w.totals.all).toBe(230 * M)
  })
})

