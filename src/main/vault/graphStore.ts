import { rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { GraphEdge, GraphNodeKind } from '../../shared/notebook/graph'

/**
 * The index's version — its layout and how the notes are read (raised when either changes: 2 — a number is a tag); another
 * one — the index is made anew (it is derived: the notes are the truth).
 */
const SCHEMA = 2

/** An edge of some note, as stored. */
export interface StoredEdge extends GraphEdge {
  path: string
}

/**
 * The notebook's graph on disk (SQLite, data/graph.db): a row per note (its text's hash, its file's stamp, the shared
 * document it is) and its edges. Derived from the notes — a broken or older file is thrown away and made again.
 */
export class GraphStore {
  private db: DatabaseSync

  constructor(private file: string) {
    this.db = this.open()
  }

  private open(): DatabaseSync {
    try {
      return this.prepare(new DatabaseSync(this.file))
    } catch {
      // broken — anew (the notes are read again)
      rmSync(this.file, { force: true })
      return this.prepare(new DatabaseSync(this.file))
    }
  }
  private prepare(db: DatabaseSync): DatabaseSync {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version !== SCHEMA) db.exec('DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS edges;')
    db.exec(`
      CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, hash TEXT NOT NULL, stamp TEXT NOT NULL, shared TEXT);
      CREATE TABLE IF NOT EXISTS edges (path TEXT NOT NULL, type TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, line INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS edges_path ON edges(path);
      CREATE INDEX IF NOT EXISTS edges_node ON edges(kind, name);
      PRAGMA user_version = ${SCHEMA};
    `)
    return db
  }
  close(): void {
    this.db.close()
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

  // ---------- a note's row ----------
  docOf(path: string): { hash: string; stamp: string } | undefined {
    return this.db.prepare('SELECT hash, stamp FROM docs WHERE path = ?').get(path) as { hash: string; stamp: string } | undefined
  }
  /** A note's edges put anew. */
  put(path: string, hash: string, stamp: string, shared: string | undefined, edges: readonly GraphEdge[]): void {
    this.tx(() => {
      this.db.prepare('INSERT INTO docs(path, hash, stamp, shared) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, stamp = excluded.stamp, shared = excluded.shared').run(path, hash, stamp, shared ?? null)
      this.db.prepare('DELETE FROM edges WHERE path = ?').run(path)
      const ins = this.db.prepare('INSERT INTO edges(path, type, kind, name, label, line) VALUES (?, ?, ?, ?, ?, ?)')
      for (const e of edges) ins.run(path, e.type, e.kind, e.name, e.label, e.line)
    })
  }
  /** The file touched, its text the same: its stamp only. */
  restamp(path: string, stamp: string): void {
    this.db.prepare('UPDATE docs SET stamp = ? WHERE path = ?').run(stamp, path)
  }
  /** A note (a folder — all under it) gone. */
  remove(path: string): void {
    this.tx(() => {
      for (const t of ['docs', 'edges']) this.db.prepare(`DELETE FROM ${t} WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'`).run(path, path, path)
    })
  }
  /** A note (a folder — all under it) renamed: its rows follow, nothing read again. */
  rename(from: string, to: string): void {
    this.tx(() => {
      for (const t of ['docs', 'edges']) this.db.prepare(`UPDATE ${t} SET path = ? || substr(path, length(?) + 1) WHERE path = ? OR substr(path, 1, length(?) + 1) = ? || '/'`).run(to, from, from, from, from)
    })
  }
  /** Every indexed note. */
  paths(): string[] {
    return (this.db.prepare('SELECT path FROM docs').all() as Array<{ path: string }>).map((r) => r.path)
  }

  // ---------- reading the graph ----------
  edgesOf(path: string): GraphEdge[] {
    return this.db.prepare('SELECT type, kind, name, label, line FROM edges WHERE path = ? ORDER BY line').all(path) as unknown as GraphEdge[]
  }
  /** The other notes having what this one has (a tag, a table…), with how many notes have each. */
  sharing(path: string): Array<StoredEdge & { df: number }> {
    return this.db
      .prepare(
        `SELECT o.path, o.type, o.kind, o.name, o.label, o.line,
           (SELECT count(DISTINCT d.path) FROM edges d WHERE d.kind = o.kind AND d.name = o.name) AS df
         FROM edges o
         WHERE o.path != ? AND EXISTS (SELECT 1 FROM edges s WHERE s.path = ? AND s.kind = o.kind AND s.name = o.name)`,
      )
      .all(path, path) as unknown as Array<StoredEdge & { df: number }>
  }
  /** Every edge to a thing of this kind (links to notes — to resolve them). */
  edgesOfKind(kind: GraphNodeKind): StoredEdge[] {
    return this.db.prepare('SELECT path, type, kind, name, label, line FROM edges WHERE kind = ?').all(kind) as unknown as StoredEdge[]
  }
  /** The note a shared document is. */
  pathOfShared(doc: string): string | undefined {
    return (this.db.prepare('SELECT path FROM docs WHERE shared = ?').get(doc) as { path: string } | undefined)?.path
  }
  sharedOf(path: string): string | undefined {
    return (this.db.prepare('SELECT shared FROM docs WHERE path = ?').get(path) as { shared: string | null } | undefined)?.shared ?? undefined
  }
  /** The edges to things whose name or label has `q` (of these kinds); a tag — `#q`: it and the ones nested in it. */
  find(q: string, kinds: readonly GraphNodeKind[], limit = 400): StoredEdge[] {
    const marks = kinds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT path, type, kind, name, label, line FROM edges WHERE kind IN (${marks}) AND (instr(name, ?) > 0 OR instr(lower(label), ?) > 0) LIMIT ?`)
      .all(...kinds, q, q, limit) as unknown as StoredEdge[]
  }
  /** The notes tagged so, or with a tag nested in it (`#a` — `#a/b` too). */
  tagged(tag: string, limit = 400): StoredEdge[] {
    return this.db
      .prepare(`SELECT path, type, kind, name, label, line FROM edges WHERE kind = 'tag' AND (name = ? OR substr(name, 1, length(?) + 1) = ? || '/') LIMIT ?`)
      .all(tag, tag, tag, limit) as unknown as StoredEdge[]
  }
  /** Every edge of the notebook to things of these kinds (the whole graph's view). */
  edgesOfKinds(kinds: readonly GraphNodeKind[]): StoredEdge[] {
    return this.db.prepare(`SELECT path, type, kind, name, label, line FROM edges WHERE kind IN (${kinds.map(() => '?').join(', ')})`).all(...kinds) as unknown as StoredEdge[]
  }
  /** Every tag with how many notes have it. */
  tags(): Array<{ name: string; label: string; count: number }> {
    return this.db.prepare(`SELECT name, min(label) AS label, count(DISTINCT path) AS count FROM edges WHERE kind = 'tag' GROUP BY name ORDER BY count DESC, name`).all() as unknown as Array<{ name: string; label: string; count: number }>
  }
}
