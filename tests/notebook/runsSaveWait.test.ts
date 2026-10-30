import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRunApi } from '../../src/notebook/engine/runApi'
import { loadedRuns, publishGathered } from '../../src/notebook/engine/runStore'

describe('the runs saved while a stream goes', () => {
  afterEach(() => vi.useRealTimers())
  it('a change every 50 ms never puts the save off for ever — a snapshot within about two seconds', async () => {
    const saves: string[] = []
    setRunApi({ runLoad: async () => undefined, runSave: async (_p: string, json: string) => void saves.push(json) } as unknown as Parameters<typeof setRunApi>[0])
    await loadedRuns('t/stream.md')
    vi.useFakeTimers()
    const list: number[] = []
    for (let i = 0; i < 60; i++) {
      list.push(i)
      publishGathered('t/stream.md', 'rows', list, 'code', 'x')
      vi.advanceTimersByTime(50)
    }
    // three seconds of a stream: saved at least once meanwhile, with what had come by then
    expect(saves.length).toBeGreaterThanOrEqual(1)
    const first = JSON.parse(saves[0]) as { ctx: { rows: { value: number[] } } }
    expect(first.ctx.rows.value.length).toBeGreaterThan(10)
    expect(first.ctx.rows.value.length).toBeLessThan(60)
  })
})
