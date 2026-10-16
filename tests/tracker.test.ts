import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ powerMonitor: { on: () => undefined } }))
import { Tracker } from '../src/main/tracker'
import type { DayData } from '../src/shared/types'

const kinds = [{ id: 'call', label: 'Созвон', color: '#14b8a6', icon: 'phone' }]
function fakeStore() {
  const days = new Map<string, DayData>()
  return {
    cfg: { kinds },
    day: (d: string) => {
      if (!days.has(d)) days.set(d, { day: d, calls: [], entries: [], notes: [] })
      return days.get(d)!
    },
    markDirty: () => undefined,
    flush: () => undefined,
    days,
  }
}
const sample = (title?: string) => ({ t: Date.now(), pid: 1, proc: 'x', path: '', mic: ['ms-teams.exe'], cw: title ? [`ms-teams.exe\t${title} | Microsoft Teams`] : [] })

describe('calls', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-16T10:00:00') }))
  afterEach(() => vi.useRealTimers())

  it('a call right after another one (another window) is a new block; one window — one call', () => {
    const store = fakeStore()
    const t = new Tracker(store as never, () => undefined)
    const step = (title: string, n: number) => {
      for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(2000)
        t.onSample(sample(title) as never, 2000, true)
      }
    }
    step('Дейли', 30) // 60 s
    step('Ревью', 30) // the next call at once
    const d = store.day('2026-10-16')
    expect(d.calls.map((c) => c.title)).toEqual(['Дейли', 'Ревью'])
    expect(d.entries.map((e) => e.label)).toEqual(['Созвон: Дейли', 'Созвон: Ревью'])
    // the first block ends where the second begins
    expect(d.entries[0].end).toBeLessThanOrEqual(d.entries[1].start)
  })

  it('a title that flickers for a moment does not split the call', () => {
    const store = fakeStore()
    const t = new Tracker(store as never, () => undefined)
    const tick = (title: string) => {
      vi.advanceTimersByTime(2000)
      t.onSample(sample(title) as never, 2000, true)
    }
    for (let i = 0; i < 20; i++) tick('Дейли')
    tick('Демонстрация экрана')
    tick('Демонстрация экрана')
    for (let i = 0; i < 10; i++) tick('Дейли')
    expect(store.day('2026-10-16').calls).toHaveLength(1)
  })
})
