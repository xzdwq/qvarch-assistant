import { describe, expect, it } from 'vitest'
import { Db, ftsQuery } from '../src/main/db'
import { atTime } from '../src/shared/timeline'
import type { DayData } from '../src/shared/types'

const day = (d: string, extra: Partial<DayData> = {}): DayData => ({ day: d, spans: [], activity: [], calls: [], entries: [], notes: [], ...extra })

describe('SQLite store', () => {
  it('keeps days and finds anything in the history (prefixes, any case, Cyrillic)', () => {
    const db = new Db(':memory:')
    db.importDays([
      day('2026-10-09', {
        entries: [{ id: 'e1', start: atTime('2026-10-09', '10:00'), end: atTime('2026-10-09', '11:00'), kind: 'task', label: 'Сайт Ройтек', description: 'описание категорий', source: 'manual', task: { key: 'RND-2574', summary: 'Описание' } }],
      }),
      day('2026-10-10', { notes: [{ id: 'n1', at: atTime('2026-10-10', '12:00'), text: 'созвон с подрядчиком', updatedAt: 0, transcript: 'обсудили ройтек' }] }),
    ])
    expect(db.listDays()).toEqual(['2026-10-09', '2026-10-10'])
    expect(db.getDay('2026-10-09')?.entries[0].label).toBe('Сайт Ройтек')

    const hits = db.search('РОЙТ')
    expect(hits.map((h) => `${h.day}:${h.kind}`)).toEqual(['2026-10-10:note', '2026-10-09:entry'])
    expect(hits[1].snippet).toContain('«Ройтек»')
    expect(db.search('rnd-2574').map((h) => h.ref)).toEqual(['e1'])
    expect(db.search('категор подряд')).toEqual([]) // all words must match in one row

    // re-saving a day replaces its index rows
    db.putDay(day('2026-10-09'))
    expect(db.search('ройтек').map((h) => h.kind)).toEqual(['note'])
  })

  it('stores own tasks and indexes them', () => {
    const db = new Db(':memory:')
    db.putTask({ id: 't1', title: 'Проверить миграции', status: 'todo', created: atTime('2026-10-11', '09:00') })
    expect(db.tasks().map((t) => t.title)).toEqual(['Проверить миграции'])
    expect(db.search('миграц').map((h) => h.kind)).toEqual(['task'])
    db.deleteTask('t1')
    expect(db.tasks()).toEqual([])
    expect(db.search('миграц')).toEqual([])
  })

  it('turns a query into FTS prefixes safely', () => {
    expect(ftsQuery(' сайт  "ройтек" ')).toBe('"сайт"* "ройтек"*')
    expect(ftsQuery('')).toBe('')
  })
})
