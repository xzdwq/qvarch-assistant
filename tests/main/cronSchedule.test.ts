import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CronSchedule, type RunNote } from '../../src/main/cron/cronSchedule'
import type { RunTrigger } from '../../src/shared/cronJobs'
import { testDir } from '../testTemp'

const at = (s: string) => new Date(s).getTime()
const flush = () => new Promise<void>((r) => setImmediate(r))

describe('notes run on a schedule', () => {
  let root: string
  let s: CronSchedule | undefined
  beforeEach(() => {
    root = testDir('cron-')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(at('2026-10-30T10:00:30'))
  })
  afterEach(() => {
    s?.stop()
    vi.useRealTimers()
  })

  it('run at its time by the window, its trigger the schedule; the journal kept on disk', async () => {
    const calls: Array<[string, RunTrigger]> = []
    const run: RunNote = async (note, trigger) => (calls.push([note, trigger]), {})
    s = new CronSchedule(root)
    const job = s.save({ note: 'a.md', expr: '* * * * *', title: 'Каждую минуту' })
    s.start(run)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(31_000)
    await flush()
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('a.md')
    expect(calls[0][1]).toMatchObject({ by: 'cron', cron: { id: job.id, title: 'Каждую минуту', expr: '* * * * *' } })
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'ok' })
    expect(JSON.parse(readFileSync(join(root, 'crons.json'), 'utf8')).jobs[0].runs).toHaveLength(1)
    // a failed run: its error kept
    const failing: RunNote = async () => ({ error: '«user»: 500' })
    s.stop()
    s = new CronSchedule(root)
    s.start(failing)
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'error', error: '«user»: 500' })
  })

  it('due while the app was closed — missed, not run late', async () => {
    writeFileSync(join(root, 'crons.json'), JSON.stringify({ lookedAt: at('2026-10-30T06:30:00'), jobs: [{ id: 'j1', note: 'a.md', expr: '0 * * * *', on: true, runs: [] }, { id: 'j2', note: 'b.md', expr: '0 * * * *', on: false, runs: [] }] }))
    const run = vi.fn<RunNote>(async () => ({}))
    s = new CronSchedule(root)
    s.start(run)
    expect(run).not.toHaveBeenCalled()
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'missed', count: 4, error: 'приложение было закрыто', at: at('2026-10-30T10:00:00') })
    expect(s.list()[1].runs).toEqual([])
  })

  it('the last run still going — the next one skipped', async () => {
    let finish: (() => void) | undefined
    const run: RunNote = () => new Promise((r) => (finish = () => r({}))) as ReturnType<RunNote>
    s = new CronSchedule(root)
    s.save({ note: 'a.md', expr: '* * * * *' })
    s.start(run)
    await vi.advanceTimersByTimeAsync(31_000)
    await vi.advanceTimersByTimeAsync(60_000)
    await flush()
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'missed', error: 'прошлый запуск ещё идёт' })
    finish?.()
    await flush()
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'ok' })
  })

  it('a broken expression refused; a renamed note followed; deleted, turned off, run now', async () => {
    s = new CronSchedule(root)
    expect(() => s!.save({ note: 'a.md', expr: 'каждый час' })).toThrow('Расписание не сохранено')
    const j = s.save({ note: 'dir/a.md', expr: '0 9 * * *' })
    s.remap('dir', 'other')
    expect(s.list()[0].note).toBe('other/a.md')
    s.remap('other/a.md', undefined)
    expect(s.list()[0].note).toBe('other/a.md')
    expect(s.save({ id: j.id, on: false }).on).toBe(false)
    s.start(async () => ({}))
    expect((await s.runNow(j.id)).state).toBe('ok')
    expect(s.list()[0].runs[0]).toMatchObject({ state: 'ok', hand: true })
    s.remove(j.id)
    expect(s.list()).toEqual([])
    await expect(s.runNow(j.id)).rejects.toThrow('Такого расписания нет')
  })
})
