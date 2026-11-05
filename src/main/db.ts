import { DatabaseSync } from 'node:sqlite'
import type { DayData, LocalTask } from '../shared/types'

/**
 * SQLite storage (node:sqlite, built into Electron's Node — no native modules):
 *  days   — one row per day, the day as JSON (the app keeps working with whole days);
 *  tasks  — own tasks ("Задачи"), e.g. made from a note.
 */
export class Db {
  readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
      -- the history's full-text index of an earlier version (nothing searched it any more)
      DROP TABLE IF EXISTS search;
    `)
  }

  close(): void {
    this.db.close()
  }

  // ---------- days ----------

  getDay(day: string): DayData | undefined {
    const row = this.db.prepare('SELECT data FROM days WHERE day = ?').get(day) as { data: string } | undefined
    if (!row) return undefined
    try {
      return JSON.parse(row.data) as DayData
    } catch {
      return undefined
    }
  }

  putDay(d: DayData): void {
    this.db.prepare('INSERT INTO days(day, data, updated) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, updated = excluded.updated').run(d.day, JSON.stringify(d), Date.now())
  }

  listDays(): string[] {
    return (this.db.prepare('SELECT day FROM days ORDER BY day').all() as Array<{ day: string }>).map((r) => r.day)
  }

  // ---------- own tasks ----------

  tasks(): LocalTask[] {
    return (this.db.prepare('SELECT data FROM tasks ORDER BY updated DESC').all() as Array<{ data: string }>).map((r) => JSON.parse(r.data) as LocalTask)
  }

  putTask(t: LocalTask): void {
    this.db.prepare('INSERT INTO tasks(id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated').run(t.id, JSON.stringify(t), Date.now())
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** One transaction for many days (the JSON import). */
  importDays(days: DayData[]): void {
    this.tx(() => {
      const put = this.db.prepare('INSERT OR REPLACE INTO days(day, data, updated) VALUES (?, ?, ?)')
      for (const d of days) put.run(d.day, JSON.stringify(d), Date.now())
    })
  }
}
