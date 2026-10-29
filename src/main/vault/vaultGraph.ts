import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { VIEW_KINDS, type GraphEdge, type GraphNodeKind, type GraphReason, type NotebookGraph, type RelatedNote } from '../../shared/notebook/graph'
import { resolveWiki } from '../../shared/vault'
import { formatOf } from '../../shared/transport/sharedFormats'
import { docGraph } from '../../notebook/domain/graph/docGraph'
import { relatedNotes, type LinkRow } from '../../notebook/domain/graph/related'
import { notebookGraph, type EdgeRow } from '../../notebook/domain/graph/notebookGraph'
import { pauseAfter, ReindexQueue, SLICE } from '../../notebook/domain/graph/reindexQueue'
import { GraphStore } from './graphStore'

/** What the graph needs of the vault: a note's file on disk, and every file of it now. */
export interface GraphVault {
  abs(rel: string): string
  files(): string[]
}
/** The things a search finds notes by (beside their text): what their components work with, their tags, tasks. */
const SEARCH_KINDS: readonly GraphNodeKind[] = ['tag', 'table', 'endpoint', 'host', 'jira']
/** The notebook is read through once this long after the start (not at the start itself — the app is busy then). */
const RECONCILE_DELAY_MS = 5000
const isNote = (rel: string) => rel.toLowerCase().endsWith('.md')

/**
 * The notebook's graph kept up to date in the background: a save marks a note (ReindexQueue — taken once settled),
 * the marked ones are indexed in slices (never holding the app; a costly one — a longer pause after it), an unchanged
 * text (its hash) is not taken apart again. A rename moves its rows, a delete drops them. At the start the notebook is
 * checked against the index (by the files' stamps) — a note changed while the app was closed is indexed again.
 * A search / «Связи» first indexes what is still waiting (their answer is never behind the notes).
 */
export class VaultGraph {
  private opened?: GraphStore
  private queue = new ReindexQueue()
  /** Notes taken off the queue, to be indexed slice by slice. */
  private backlog: string[] = []
  private timer?: NodeJS.Timeout
  private started = false
  private closed = false

  constructor(
    private dataRoot: string,
    private vault: GraphVault,
  ) {}

  /** The index, opened when first needed (a vault only packing a document never opens it). */
  private get store(): GraphStore {
    if (this.closed) throw new Error('graph closed')
    return (this.opened ??= new GraphStore(join(this.dataRoot, 'graph.db')))
  }

  /** The background work begins (before it, saves are only marked — the start's check takes them anyway). */
  start(): void {
    this.started = true
    this.timer = setTimeout(() => this.reconcile(), RECONCILE_DELAY_MS)
  }
  close(): void {
    this.closed = true
    clearTimeout(this.timer)
    this.opened?.close()
    this.opened = undefined
  }

  // ---------- changes ----------
  /** A note saved (by the app, an AI, outside): marked only. */
  touched(rel: string): void {
    if (!isNote(rel) || this.closed) return
    this.queue.mark(rel, Date.now())
    this.schedule()
  }
  moved(from: string, to: string): void {
    this.queue.rename(from, to)
    this.backlog = this.backlog.map((p) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p))
    if (this.opened) this.safely(() => this.store.rename(from, to))
  }
  removed(rel: string): void {
    this.queue.drop(rel)
    if (this.opened) this.safely(() => this.store.remove(rel))
  }

  /** The notebook against the index: notes gone — dropped; every other one checked (by its stamp, in slices). */
  private reconcile(): void {
    if (this.closed) return
    const files = new Set(this.vault.files().filter(isNote))
    this.safely(() => {
      for (const p of this.store.paths()) if (!files.has(p)) this.store.remove(p)
    })
    this.backlog.push(...files)
    this.schedule()
  }

  // ---------- indexing ----------
  /** The next slice: now (a backlog), or when the next note settles. */
  private schedule(delay?: number): void {
    if (!this.started || this.closed) return
    clearTimeout(this.timer)
    const next = this.backlog.length ? 0 : this.queue.nextDue()
    if (next === undefined) return
    this.timer = setTimeout(() => this.slice(), delay ?? Math.max(0, next - Date.now()))
  }
  private slice(): void {
    this.backlog.push(...this.queue.takeDue(Date.now()).filter((p) => !this.backlog.includes(p)))
    const t0 = performance.now()
    while (this.backlog.length && performance.now() - t0 < SLICE.budgetMs) this.index(this.backlog.shift()!)
    const spent = performance.now() - t0
    if (this.backlog.length) this.schedule(pauseAfter(spent))
    else this.schedule()
  }
  /**
   * The notes saved and not yet indexed — indexed now (a search, «Связи» are never behind what was just written).
   * The start's check of the whole notebook goes on in the background (it is not what was just written).
   */
  private flush(): void {
    const recent = this.queue.takeAll()
    this.backlog = this.backlog.filter((p) => !recent.includes(p))
    for (const p of recent) this.index(p)
  }
  /** One note: its stamp the same — nothing; its text the same — the stamp; else its edges anew. Gone — dropped. */
  private index(rel: string): void {
    this.safely(() => {
      const file = this.vault.abs(rel)
      let st: { mtimeMs: number; size: number }
      try {
        st = statSync(file)
      } catch {
        return this.store.remove(rel)
      }
      const stamp = `${st.mtimeMs}|${st.size}`
      const was = this.store.docOf(rel)
      if (was?.stamp === stamp) return
      const text = readFileSync(file, 'utf8')
      const hash = createHash('sha1').update(text).digest('hex')
      if (was?.hash === hash) return this.store.restamp(rel, stamp)
      this.store.put(rel, hash, stamp, formatOf(rel)?.docOf(text) || undefined, docGraph(text))
    })
  }
  /** The index is a help, never a hindrance: its failure leaves the notes and the app as they are. */
  private safely(fn: () => void): void {
    try {
      fn()
    } catch (e) {
      console.warn('[graph]', e instanceof Error ? e.message : e)
    }
  }

  // ---------- asking ----------
  /** The links of a note to notes (`[[…]]`, shared notes' links), resolved among the notes there are now. */
  private linksOut(rel: string, edges: readonly GraphEdge[], files: string[]): LinkRow[] {
    const out: LinkRow[] = []
    for (const e of edges) {
      const to = e.kind === 'note' ? resolveWiki(e.name, files) : e.kind === 'doc' ? this.store.pathOfShared(e.name) : undefined
      if (to && to !== rel && !out.some((l) => l.path === to)) out.push({ path: to, label: e.label })
    }
    return out
  }
  /** The notes linking to this one. */
  private linksIn(rel: string, files: string[]): LinkRow[] {
    const shared = this.store.sharedOf(rel)
    const out: LinkRow[] = []
    const add = (path: string, label: string) => path !== rel && !out.some((l) => l.path === path) && out.push({ path, label })
    for (const e of this.store.edgesOfKind('note')) if (resolveWiki(e.name, files) === rel) add(e.path, e.label)
    if (shared) for (const e of this.store.edgesOfKind('doc')) if (e.name === shared) add(e.path, e.label)
    return out
  }
  /** The notes linking to this one (`[[…]]`). */
  backlinks(rel: string): string[] {
    this.flush()
    return this.linksIn(rel, this.vault.files()).map((l) => l.path)
  }
  /** «Связи»: the notes linking here, and the related ones with why. */
  related(rel: string): { backlinks: string[]; related: RelatedNote[] } {
    this.flush()
    const files = this.vault.files()
    const into = this.linksIn(rel, files)
    const out = this.linksOut(rel, this.store.edgesOf(rel), files)
    const there = new Set(files)
    const shared = this.store.sharing(rel).filter((s) => there.has(s.path))
    return { backlinks: into.map((l) => l.path), related: relatedNotes(shared, out, into) }
  }
  /** The notes a search finds by their graph: `#тег` — tagged so (nested ones too); else — by what they work with. */
  search(q: string): Map<string, GraphReason[]> {
    this.flush()
    const want = q.trim().toLowerCase()
    const out = new Map<string, GraphReason[]>()
    // a tag — any length (`#1`); anything else — two letters at least (one finds everything)
    if (!want.replace(/^#/, '') || (!want.startsWith('#') && want.length < 2)) return out
    const rows = want.startsWith('#') ? this.store.tagged(want.slice(1)) : this.store.find(want, SEARCH_KINDS)
    for (const r of rows) {
      const list = out.get(r.path) ?? out.set(r.path, []).get(r.path)!
      if (!list.some((x) => x.kind === r.kind && x.label === r.label)) list.push({ via: 'shared', kind: r.kind, label: r.label, type: r.type })
    }
    return out
  }
  /** Every tag with how many notes have it. */
  tags(): Array<{ name: string; label: string; count: number }> {
    this.flush()
    return this.store.tags()
  }
  /** The notes tagged so (`a` — `a/b` too). */
  tagged(tag: string): string[] {
    this.flush()
    return [...new Set(this.store.tagged(tag.replace(/^#/, '').toLowerCase(), 100_000).map((r) => r.path))]
  }
  /** The whole notebook as a graph to draw: notes, what they share, their links. */
  notebook(): NotebookGraph {
    this.flush()
    const files = this.vault.files().filter(isNote)
    const resolve = (r: EdgeRow) => (r.kind === 'note' ? resolveWiki(r.name, files) : this.store.pathOfShared(r.name))
    return notebookGraph(files, this.store.edgesOfKinds(['note', 'doc', ...VIEW_KINDS]), resolve)
  }
}
