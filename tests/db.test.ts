import { describe, expect, it } from 'vitest'
import { Db } from '../src/main/db'
import { atTime } from '../src/shared/timeline'
import type { DayData } from '../src/shared/types'

const day = (d: string, extra: Partial<DayData> = {}): DayData => ({ day: d, calls: [], entries: [], notes: [], ...extra })

describe('SQLite store', () => {
  it('keeps days (one import, then a day written again)', () => {
    const db = new Db(':memory:')
    db.importDays([
      day('2026-10-09', {
        entries: [{ id: 'e1', start: atTime('2026-10-09', '10:00'), end: atTime('2026-10-09', '11:00'), kind: 'task', label: 'Сайт Альфа', source: 'manual' }],
      }),
      day('2026-10-10'),
    ])
    expect(db.listDays()).toEqual(['2026-10-09', '2026-10-10'])
    expect(db.getDay('2026-10-09')?.entries[0].label).toBe('Сайт Альфа')
    db.putDay(day('2026-10-09'))
    expect(db.getDay('2026-10-09')?.entries).toEqual([])
  })

  it('stores own tasks, the newest first', () => {
    const db = new Db(':memory:')
    db.putTask({ id: 't1', title: 'Проверить миграции', status: 'todo', created: atTime('2026-10-11', '09:00') })
    expect(db.tasks().map((t) => t.title)).toEqual(['Проверить миграции'])
  })

  it('drops the index of an earlier version', () => {
    const db = new Db(':memory:')
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE name = 'search'").get()).toBeUndefined()
  })
})
