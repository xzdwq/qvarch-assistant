import type { DatabaseSync } from 'node:sqlite'
import { BUILTIN_GUIDES } from '../../shared/agent/harness/builtinGuides'
import { guideSeed } from '../../shared/agent/harness/guideSeed'
import { cleanGuide, type HarnessGuide } from '../../shared/agent/harness/guides'

interface Row {
  id: string
  title: string
  summary: string
  body: string
  enabled: number
  origin: string
  edited: number
}

/**
 * The harness's instructions for kinds of tasks, in the app's database (harness_guides): the app's own set put in at
 * the start (new ones added, the unedited ones brought up to date, the deleted ones never back — harness_guides_gone),
 * the person's edits and own ones kept.
 */
export class GuideStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS harness_guides (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL, origin TEXT NOT NULL, edited INTEGER NOT NULL, pos INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS harness_guides_gone (id TEXT PRIMARY KEY);
    `)
    const gone = new Set((db.prepare('SELECT id FROM harness_guides_gone').all() as Array<{ id: string }>).map((r) => r.id))
    for (const g of guideSeed(this.list(), BUILTIN_GUIDES, gone)) this.put(g)
  }

  list(): HarnessGuide[] {
    const rows = this.db.prepare('SELECT * FROM harness_guides ORDER BY pos, rowid').all() as unknown as Row[]
    return rows.map((r) => ({ id: r.id, title: r.title, summary: r.summary, body: r.body, enabled: !!r.enabled, origin: r.origin === 'builtin' ? 'builtin' : 'user', edited: !!r.edited }))
  }
  /** Saved as the person changed it (a built-in one — marked edited: the app's updates leave it be). */
  save(input: unknown): HarnessGuide[] {
    const g = cleanGuide(input)
    if (typeof g === 'string') throw new Error(g)
    const was = this.list().find((x) => x.id === g.id)
    const builtin = was?.origin === 'builtin'
    const changed = !!was && (was.title !== g.title || was.summary !== g.summary || was.body !== g.body)
    this.put({ ...g, origin: builtin ? 'builtin' : 'user', edited: builtin ? was.edited || changed : false })
    return this.list()
  }
  remove(id: string): HarnessGuide[] {
    const was = this.list().find((x) => x.id === id)
    this.db.prepare('DELETE FROM harness_guides WHERE id = ?').run(id)
    // (the app's own one deleted: not put back by an update)
    if (was?.origin === 'builtin') this.db.prepare('INSERT OR IGNORE INTO harness_guides_gone (id) VALUES (?)').run(id)
    return this.list()
  }
  /** A built-in one back to the app's text (and the app's updates again). */
  reset(id: string): HarnessGuide[] {
    const b = BUILTIN_GUIDES.find((x) => x.id === id)
    if (!b) throw new Error('Это не встроенная инструкция')
    this.db.prepare('DELETE FROM harness_guides_gone WHERE id = ?').run(id)
    const was = this.list().find((x) => x.id === id)
    this.put({ ...b, enabled: was?.enabled ?? true, origin: 'builtin', edited: false })
    return this.list()
  }

  private put(g: HarnessGuide): void {
    const pos = (this.db.prepare('SELECT pos FROM harness_guides WHERE id = ?').get(g.id) as { pos: number } | undefined)?.pos ?? this.nextPos()
    this.db
      .prepare('INSERT INTO harness_guides (id, title, summary, body, enabled, origin, edited, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary, body = excluded.body, enabled = excluded.enabled, origin = excluded.origin, edited = excluded.edited')
      .run(g.id, g.title, g.summary, g.body, g.enabled ? 1 : 0, g.origin, g.edited ? 1 : 0, pos)
  }
  private nextPos(): number {
    return ((this.db.prepare('SELECT max(pos) m FROM harness_guides').get() as { m: number | null }).m ?? -1) + 1
  }
}
