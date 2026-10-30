import { describe, expect, it } from 'vitest'
import { cleanJob, cronCheck, cronMark, dueBetween, jobTitle, nextDue, withRun, CRON_RUNS_KEPT, type CronJob } from '../../src/shared/cronJobs'

const at = (s: string) => new Date(s).getTime()

describe('scheduled notes', () => {
  it('an expression checked: in words and its next runs; broken — why', () => {
    const ok = cronCheck('0 9 * * 1-5', 2, new Date('2026-10-30T10:00:00'))
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.next.map((d) => d.getDate())).toEqual([2, 3])
    expect(cronCheck('каждый день').ok).toBe(false)
    expect(cronCheck('0 9 * *').ok).toBe(false)
    expect(cronCheck('0 0/30 * * * *').ok).toBe(true)
  })
  it('due between: the times it should have run while the app was closed', () => {
    expect(dueBetween('0 * * * *', at('2026-10-30T10:30:00'), at('2026-10-30T13:10:00')).map((t) => new Date(t).getHours())).toEqual([11, 12, 13])
    expect(dueBetween('0 * * * *', at('2026-10-30T10:30:00'), at('2026-10-30T10:50:00'))).toEqual([])
    expect(dueBetween('* * * * *', 0, at('2026-10-30T10:00:00'), 5)).toHaveLength(5)
  })
  it('next due: none when off', () => {
    expect(nextDue({ expr: '0 9 * * *', on: true }, at('2026-10-30T10:00:00'))).toBe(at('2026-10-31T09:00:00'))
    expect(nextDue({ expr: '0 9 * * *', on: false })).toBeUndefined()
  })
  it('kept: checked; broken — none; the journal capped, newest first', () => {
    expect(cleanJob({ note: '\\dir\\a.md', expr: ' 0  9 * * * ' })).toMatchObject({ note: 'dir/a.md', expr: '0 9 * * *', on: true, title: '', runs: [] })
    expect(cleanJob({ note: 'a.md', expr: 'nope' })).toBeUndefined()
    expect(cleanJob({ expr: '0 9 * * *' })).toBeUndefined()
    let j = cleanJob({ note: 'a.md', expr: '0 9 * * *' }) as CronJob
    for (let i = 0; i < CRON_RUNS_KEPT + 5; i++) j = withRun(j, { at: i, state: 'ok' })
    expect(j.runs).toHaveLength(CRON_RUNS_KEPT)
    expect(j.runs[0].at).toBe(CRON_RUNS_KEPT + 4)
  })
  it('a title — its own, else the note\'s; a scheduled message marked', () => {
    expect(jobTitle({ title: '', note: 'dir/Отчёт.md' })).toBe('Отчёт')
    expect(jobTitle({ title: 'Утро', note: 'dir/Отчёт.md' })).toBe('Утро')
    expect(cronMark({ by: 'cron', at: 1, cron: { id: 'x', title: 'Утро', expr: '0 9 * * *' } })).toBe('⏰ по расписанию «Утро» (0 9 * * *)')
    expect(cronMark({ by: 'hand', at: 1 })).toBe('')
    expect(cronMark(undefined)).toBe('')
  })
})
