import { DatabaseSync } from 'node:sqlite'
import type { DayData, LocalTask, Ms, SearchHit } from '../shared/types'

/**
 * SQLite storage (node:sqlite, built into Electron's Node — no native modules):
 *  days   — one row per day, the day as JSON (the app keeps working with whole days);
 *  search — a full-text index (FTS5) over everything worth finding later: blocks, descriptions,
 *           Jira tasks, notes and their transcripts, plans, own tasks;
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
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
        day UNINDEXED, kind UNINDEXED, ref UNINDEXED, at UNINDEXED, text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
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

  /** Writes the day and re-indexes it, in one transaction. */
  putDay(d: DayData): void {
    this.tx(() => {
      this.db.prepare('INSERT INTO days(day, data, updated) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, updated = excluded.updated').run(d.day, JSON.stringify(d), Date.now())
      this.db.prepare('DELETE FROM search WHERE day = ?').run(d.day)
      const ins = this.db.prepare('INSERT INTO search(day, kind, ref, at, text) VALUES (?, ?, ?, ?, ?)')
      for (const r of indexRows(d)) ins.run(d.day, r.kind, r.ref, r.at, r.text)
    })
  }

  listDays(): string[] {
    return (this.db.prepare('SELECT day FROM days ORDER BY day').all() as Array<{ day: string }>).map((r) => r.day)
  }

  countDays(): number {
    return (this.db.prepare('SELECT count(*) n FROM days').get() as { n: number }).n
  }

  // ---------- own tasks ----------

  tasks(): LocalTask[] {
    return (this.db.prepare('SELECT data FROM tasks ORDER BY updated DESC').all() as Array<{ data: string }>).map((r) => JSON.parse(r.data) as LocalTask)
  }

  putTask(t: LocalTask): void {
    this.tx(() => {
      this.db.prepare('INSERT INTO tasks(id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated').run(t.id, JSON.stringify(t), Date.now())
      this.db.prepare("DELETE FROM search WHERE kind = 'task' AND ref = ?").run(t.id)
      this.db.prepare("INSERT INTO search(day, kind, ref, at, text) VALUES (?, 'task', ?, ?, ?)").run(dayOf(t.created), t.id, t.created, [t.title, t.description, t.project].filter(Boolean).join('\n'))
    })
  }

  deleteTask(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      this.db.prepare("DELETE FROM search WHERE kind = 'task' AND ref = ?").run(id)
    })
  }

  // ---------- search ----------

  /** Full-text search over the whole history (every word as a prefix, all must match), newest first. */
  search(q: string, limit = 100): SearchHit[] {
    const match = ftsQuery(q)
    if (!match) return []
    return this.db
      .prepare(
        `SELECT day, kind, ref, at, snippet(search, 4, '«', '»', '…', 12) AS snippet
         FROM search WHERE search MATCH ? ORDER BY day DESC, CAST(at AS INTEGER) DESC LIMIT ?`,
      )
      .all(match, limit)
      .map((r) => {
        const x = r as { day: string; kind: SearchHit['kind']; ref: string; at: number | string; snippet: string }
        return { day: x.day, kind: x.kind, ref: x.ref, at: Number(x.at), snippet: x.snippet }
      })
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
      const del = this.db.prepare('DELETE FROM search WHERE day = ?')
      const ins = this.db.prepare('INSERT INTO search(day, kind, ref, at, text) VALUES (?, ?, ?, ?, ?)')
      for (const d of days) {
        put.run(d.day, JSON.stringify(d), Date.now())
        del.run(d.day)
        for (const r of indexRows(d)) ins.run(d.day, r.kind, r.ref, r.at, r.text)
      }
    })
  }
}

const dayOf = (t: Ms) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "ройт кат" → «"ройт"* "кат"*» — every word is a prefix, all must be present. */
export function ftsQuery(q: string): string {
  return q
    .split(/[\s,.;:!?()[\]{}"'«»]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 12)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' ')
}

/** What of a day goes into the search index. */
export function indexRows(d: DayData): Array<{ kind: SearchHit['kind']; ref: string; at: Ms; text: string }> {
  const rows: Array<{ kind: SearchHit['kind']; ref: string; at: Ms; text: string }> = []
  for (const e of d.entries) {
    const text = [e.label, e.description, e.task ? `${e.task.key} ${e.task.summary}` : ''].filter(Boolean).join('\n')
    if (text) rows.push({ kind: 'entry', ref: e.id, at: e.start, text })
  }
  for (const n of d.notes ?? []) {
    const text = [n.text, n.transcript].filter(Boolean).join('\n')
    if (text.trim()) rows.push({ kind: 'note', ref: n.id, at: n.at, text })
  }
  for (const t of d.dayTasks ?? []) rows.push({ kind: 'task', ref: t.key, at: 0, text: `${t.key} ${t.summary}` })
  for (const p of d.plan ?? []) rows.push({ kind: 'plan', ref: p.id, at: p.start, text: [p.label, p.task ? `${p.task.key} ${p.task.summary}` : ''].join('\n') })
  return rows
}
