import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { setRunApi } from '../../src/notebook/engine/runApi'
import { loadedRuns } from '../../src/notebook/engine/runStore'
import { noteRunsGoing, noteRunsSettled } from '../../src/notebook/engine/runWait'
import type { NoteRun } from '../../src/notebook/engine/runTypes'

setRunApi({ runLoad: async () => undefined, runSave: async () => undefined } as unknown as Parameters<typeof setRunApi>[0])
const note = (o: Partial<NoteRun>): NoteRun => ({ ctx: {}, runs: {}, loops: {}, loaded: true, ...o })

describe('a note’s runs going on', () => {
  it('a block, a loop’s pass or its blocks, «Выполнить всё» — going; someone else’s run and a stopped «all» — not', () => {
    expect(noteRunsGoing(note({}))).toBe(false)
    expect(noteRunsGoing(note({ runs: { a: { state: 'run', at: 0 } } }))).toBe(true)
    expect(noteRunsGoing(note({ runs: { a: { state: 'run', at: 0, by: 'peer' } } }))).toBe(false)
    const pass = { n: 1, vars: {}, state: 'ok' as const, at: 0, values: {}, runs: { b: { state: 'run' as const, at: 0 } } }
    expect(noteRunsGoing(note({ loops: { l: { state: 'ok', at: 0, passes: [pass] } } }))).toBe(true)
    expect(noteRunsGoing(note({ all: { at: 'x', done: 1, total: 3 } }))).toBe(true)
    expect(noteRunsGoing(note({ all: { at: 'x', done: 1, total: 3, error: 'Остановлено' } }))).toBe(false)
  })
  it('waits for the run to end — at once when nothing runs, false past the limit', async () => {
    const n = await loadedRuns('t/wait.md')
    expect(await noteRunsSettled('t/wait.md', 1000)).toBe(true)
    n.runs.a = { state: 'run', at: 0 }
    const settled = noteRunsSettled('t/wait.md', 1000)
    await nextTick()
    n.runs.a = { state: 'ok', at: 1 }
    expect(await settled).toBe(true)
    n.runs.b = { state: 'run', at: 0 }
    expect(await noteRunsSettled('t/wait.md', 20)).toBe(false)
  })
})
