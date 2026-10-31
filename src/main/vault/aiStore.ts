import { DatabaseSync } from 'node:sqlite'
import type { AgentLines } from '../../shared/notebook/agentLines'
import { docAiOf, type DocAi } from '../../shared/agent/docAi'

/**
 * What the AI keeps of each personal note, in the vault (vault/.ai.db, SQLite): its memory and journal (docAi), the
 * lines agents wrote in it — a row per note, written alone (not the whole vault's marks each time a turn ends). Kept
 * beside the notes (it is theirs, not derived: it goes where the vault goes); one file, opened for each use only (a
 * turn's — rare): never held, the vault may be moved or taken away.
 */
export class AiStore {
  constructor(private file: string) {}

  private use<T>(fn: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.file)
    try {
      db.exec(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE IF NOT EXISTS doc_ai (path TEXT PRIMARY KEY, ai TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_lines (path TEXT PRIMARY KEY, lines TEXT NOT NULL);
      `)
      return fn(db)
    } finally {
      db.close()
    }
  }

  docAi(path: string): DocAi {
    const r = this.use((db) => db.prepare('SELECT ai FROM doc_ai WHERE path = ?').get(path) as { ai: string } | undefined)
    return docAiOf(r ? parse(r.ai) : undefined)
  }
  /** Every note's memory and journal at once (a search over them — one read). */
  allDocAi(): Map<string, DocAi> {
    const rows = this.use((db) => db.prepare('SELECT path, ai FROM doc_ai').all() as Array<{ path: string; ai: string }>)
    return new Map(rows.map((r) => [r.path, docAiOf(parse(r.ai))]))
  }
  /** A note's memory and journal (empty — the row taken away). */
  setDocAi(path: string, ai: DocAi): void {
    this.use((db) => putDocAi(db, path, ai))
  }
  agentLines(path: string): AgentLines {
    const r = this.use((db) => db.prepare('SELECT lines FROM agent_lines WHERE path = ?').get(path) as { lines: string } | undefined)
    const v = r ? parse(r.lines) : undefined
    return v && typeof v === 'object' ? (v as AgentLines) : {}
  }
  setAgentLines(path: string, lines: AgentLines): void {
    this.use((db) => putAgentLines(db, path, lines))
  }

  /** The rows follow a rename / move of a note or a folder (`to` undefined — deleted: they go). */
  remap(from: string, to?: string): void {
    this.use((db) => {
      for (const table of ['doc_ai', 'agent_lines'] as const) {
        const rows = db.prepare(`SELECT path FROM ${table} WHERE path = ? OR substr(path, 1, ?) = ?`).all(from, from.length + 1, `${from}/`) as Array<{ path: string }>
        for (const { path } of rows) {
          if (to === undefined) db.prepare(`DELETE FROM ${table} WHERE path = ?`).run(path)
          else db.prepare(`UPDATE OR REPLACE ${table} SET path = ? WHERE path = ?`).run(to + path.slice(from.length), path)
        }
      }
    })
  }

  /** What the vault kept in its marks' file before (moved here once, all together). */
  takeOver(old: { docAi?: Record<string, unknown>; agentLines?: Record<string, AgentLines> }): void {
    this.use((db) => {
      db.exec('BEGIN')
      try {
        for (const [path, ai] of Object.entries(old.docAi ?? {})) putDocAi(db, path, docAiOf(ai))
        for (const [path, lines] of Object.entries(old.agentLines ?? {})) putAgentLines(db, path, lines)
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    })
  }
}

function putDocAi(db: DatabaseSync, path: string, ai: DocAi): void {
  const clean = docAiOf(ai)
  if (clean.memory || clean.turns.length) db.prepare('INSERT INTO doc_ai (path, ai) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET ai = excluded.ai').run(path, JSON.stringify(clean))
  else db.prepare('DELETE FROM doc_ai WHERE path = ?').run(path)
}
function putAgentLines(db: DatabaseSync, path: string, lines: AgentLines): void {
  if (Object.keys(lines).length) db.prepare('INSERT INTO agent_lines (path, lines) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET lines = excluded.lines').run(path, JSON.stringify(lines))
  else db.prepare('DELETE FROM agent_lines WHERE path = ?').run(path)
}
function parse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
