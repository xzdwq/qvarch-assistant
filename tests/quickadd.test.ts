import { describe, expect, it } from 'vitest'
import { parseQuick } from '../src/shared/quickadd'
import { dayStart } from '../src/shared/timeline'

const DAY = '2026-10-16' // a Friday
const ctx = { day: DAY, weekStart: '2026-10-12', kinds: [{ id: 'meeting', label: 'Встреча' }, { id: 'call', label: 'Созвон' }, { id: 'task', label: 'Задача' }] }
const t = (d: string, hm: string) => dayStart(d) + +hm.split(':')[0] * 3_600_000 + +(hm.split(':')[1] ?? 0) * 60_000

describe('parseQuick', () => {
  it('a range, a task and a kind; the rest is the title', () => {
    const q = parseQuick('ревью DOS-123 14:00-15:30 #встр', ctx)
    expect(q).toMatchObject({ label: 'ревью', task: 'DOS-123', kind: 'meeting', day: DAY, start: t(DAY, '14:00'), end: t(DAY, '15:30') })
  })
  it('hours without minutes, "с … до …"', () => {
    expect(parseQuick('планёрка 9-10', ctx)).toMatchObject({ label: 'планёрка', start: t(DAY, '9:00'), end: t(DAY, '10:00') })
    expect(parseQuick('с 9 до 11 обучение', ctx)).toMatchObject({ label: 'обучение', start: t(DAY, '9:00'), end: t(DAY, '11:00') })
  })
  it('a start and a duration', () => {
    expect(parseQuick('в 9:30 1ч30м дейли', ctx)).toMatchObject({ label: 'дейли', start: t(DAY, '9:30'), end: t(DAY, '11:00'), dur: 90 * 60_000 })
    expect(parseQuick('доки 1.5ч', ctx)).toMatchObject({ label: 'доки', dur: 90 * 60_000 })
    expect(parseQuick('звонок 45 мин', ctx)).toMatchObject({ label: 'звонок', dur: 45 * 60_000 })
  })
  it('days: words, weekdays of the shown week, dd.mm', () => {
    expect(parseQuick('завтра 10:00 демо', ctx).day).toBe('2026-10-17')
    expect(parseQuick('во вторник отчёт', ctx)).toMatchObject({ day: '2026-10-13', label: 'отчёт' })
    expect(parseQuick('пн созвон', ctx).day).toBe('2026-10-12')
    expect(parseQuick('20.10 релиз', ctx)).toMatchObject({ day: '2026-10-20', label: 'релиз' })
    // 9.30 is a time (30 can't be a month)
    expect(parseQuick('9.30 кофе', ctx)).toMatchObject({ day: DAY, start: t(DAY, '9:30') })
  })
  it('leaves what it does not know in the title', () => {
    expect(parseQuick('#неважно версия 2.0 готова', ctx)).toMatchObject({ label: '#неважно версия 2.0 готова' })
    expect(parseQuick('DOS-7', ctx)).toMatchObject({ label: '', task: 'DOS-7' })
  })
})
