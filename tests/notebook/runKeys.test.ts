import { describe, expect, it } from 'vitest'
import { NoteEnv } from '../../src/notebook/engine/runEnv'
import { moveRun, noteRun } from '../../src/notebook/engine/runStore'

describe('a run going on while its block gets its id', () => {
  it('writes where its results moved, is stopped from there; once over — the key is plain', () => {
    const path = `runKeys-${Math.random()}.md`
    const env = new NoteEnv(path)
    env.recordRun('search', { state: 'run', at: 1 })
    // the editor gives the block its id: its results (the run going on too) go to the new key
    moveRun(path, 'search', '_abc123')
    expect(env.runSlot('_abc123')).toBe(env.runSlot('search'))
    env.recordRun('search', { state: 'ok', at: 2 })
    const n = noteRun(path)
    expect(n.runs._abc123?.state).toBe('ok')
    expect(n.runs.search).toBeUndefined()
    // (over: a new run under the new key goes by it)
    expect(env.runSlot('_abc123')).toBe(`${path}#_abc123`)
  })
  it('a run not going on moves as it was', () => {
    const path = `runKeys-${Math.random()}.md`
    const env = new NoteEnv(path)
    env.recordRun('x', { state: 'ok', at: 1 })
    moveRun(path, 'x', '_id')
    expect(env.runSlot('_id')).toBe(`${path}#_id`)
    expect(noteRun(path).runs._id?.state).toBe('ok')
  })
})
