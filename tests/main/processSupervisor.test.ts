import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A stand-in for Electron's utility process: messages in and out, kill, exit. */
class FakeProc extends EventEmitter {
  sent: unknown[] = []
  killed = false
  postMessage(m: unknown) {
    this.sent.push(m)
  }
  kill() {
    this.killed = true
    return true
  }
}
const procs: FakeProc[] = []
vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      const p = new FakeProc()
      procs.push(p)
      return p
    },
  },
}))
const { ProcessSupervisor } = await import('../../src/main/process/processSupervisor')

type R = { ok: boolean; error?: string; ms: number; v?: number }
const make = (stop: 'kill' | 'ask', restart: 'kill' | 'stop' = 'kill') =>
  new ProcessSupervisor<R>({
    script: () => 'w.js',
    serviceName: 'Test',
    memoryMb: 64,
    failure: (error, ms) => ({ ok: false, error, ms }),
    stop: stop === 'kill' ? { kind: 'kill' } : { kind: 'ask', message: { type: 'stop' }, graceMs: 1000 },
    restart,
  })
const runOpts = (extra: object = {}) => ({ job: { go: 1 }, timeoutSec: 5, timeoutError: 'too long', onMessage: (m: unknown, run: { finish(r: R): void }) => run.finish(m as R), exitError: () => 'exited', ...extra })

beforeEach(() => {
  procs.length = 0
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('process supervisor', () => {
  it('a run: the job sent, the answer is its result, the process killed', async () => {
    const s = make('kill')
    const done = s.start('a', runOpts())
    expect(procs[0].sent).toEqual([{ go: 1 }])
    procs[0].emit('message', { ok: true, ms: 1, v: 7 })
    expect(await done).toEqual({ ok: true, ms: 1, v: 7 })
    expect(procs[0].killed).toBe(true)
    expect(s.has('a')).toBe(false)
  })
  it('started again: the old run answered «Перезапущено», its late words ignored', async () => {
    const s = make('kill')
    const first = s.start('a', runOpts())
    const second = s.start('a', runOpts())
    expect(await first).toMatchObject({ ok: false, error: 'Перезапущено' })
    expect(procs[0].killed).toBe(true)
    procs[0].emit('message', { ok: true, ms: 1, v: 1 })
    procs[0].emit('exit', 1)
    expect(s.has('a')).toBe(true)
    procs[1].emit('message', { ok: true, ms: 1, v: 2 })
    expect(await second).toMatchObject({ v: 2 })
  })
  it('past its time: stopped with the time-out error', async () => {
    const s = make('kill')
    const done = s.start('a', runOpts())
    vi.advanceTimersByTime(5000)
    expect(await done).toEqual({ ok: false, error: 'too long', ms: 5000 })
  })
  it('asked to stop: its own error result gets the reason; silent — killed after the grace time', async () => {
    const s = make('ask')
    const done = s.start('a', runOpts())
    s.stop('a', 'Остановлено')
    expect(procs[0].sent).toEqual([{ go: 1 }, { type: 'stop' }])
    procs[0].emit('message', { ok: false, error: 'cancelled', ms: 3 })
    expect(await done).toEqual({ ok: false, error: 'Остановлено', ms: 3 })
    const silent = s.start('b', runOpts())
    s.stop('b', 'Стоп')
    vi.advanceTimersByTime(1000)
    expect(await silent).toMatchObject({ ok: false, error: 'Стоп' })
    expect(procs[1].killed).toBe(true)
  })
  it('the window that asked closed: the run ends', async () => {
    const owner = new EventEmitter()
    const s = make('kill')
    const done = s.start('a', runOpts({ owner }))
    owner.emit('destroyed')
    expect(await done).toMatchObject({ ok: false, error: 'Окно закрыто' })
  })
  it('the process exits by itself: its exit error', async () => {
    const s = make('kill')
    const done = s.start('a', runOpts())
    procs[0].emit('exit', 3)
    expect(await done).toMatchObject({ ok: false, error: 'exited' })
  })
})
