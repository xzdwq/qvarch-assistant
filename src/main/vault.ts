import { shell } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import { audiosOf, filesOf, imagesOf, type VaultEntryKind, type VaultHit, type VaultNode } from '../shared/vault'
import { findNode } from '../shared/vaultTree'
import { BOARD_EXT } from '../shared/whiteboard'
import type { DocBundle } from '../shared/docBundle'
import type { AgentLines } from '../shared/notebook/agentLines'
import { NO_DOC_AI, type DocAi } from '../shared/agent/docAi'
import { metaHits } from '../shared/agent/docAiSearch'
import { cleanName, VaultFiles } from './vault/vaultFiles'
import { VaultMeta } from './vault/vaultMeta'
import { VaultRuns } from './vault/vaultRuns'
import { VaultMedia } from './vault/vaultMedia'
import { VaultBundles } from './vault/vaultBundle'
import { VaultWatcher } from './vault/vaultWatcher'
import { readVaultTree } from './vault/vaultTree'
import { VaultFacts } from './vault/vaultFacts'
import { eventMentions, searchNotes } from './vault/vaultSearch'
import { VaultGraph } from './vault/vaultGraph'
import type { NotebookGraph, RelatedNote } from '../shared/notebook/graph'

/** A new thing's default name and extension, by its kind. */
const NEW_KIND: Record<VaultEntryKind, { name: string; ext: string }> = {
  note: { name: 'Без названия', ext: '.md' },
  board: { name: 'Доска', ext: BOARD_EXT },
  folder: { name: 'Новая папка', ext: '' },
}

/**
 * The notebook: plain Markdown files in data/vault (folders are sections) — like an Obsidian vault, they can be
 * opened by any editor. Voice recordings of the notes go to vault/.audio (dot folders are not listed).
 * Paths between main and the renderer are relative to the vault, with "/" separators.
 * This class is the vault's one face: it keeps the files, the marks, the runs, the media, the bundles and the
 * watcher in step (a move / delete reaches them all).
 */
/** Who is told of the vault's changes: notes and folders changed outside; media files that appeared (any way). */
export interface VaultListeners {
  onChange: (paths: string[]) => void
  onMedia: (rels: string[]) => void
}

export class Vault {
  readonly root: string
  private files: VaultFiles
  private meta: VaultMeta
  private runs: VaultRuns
  private media: VaultMedia
  private bundles: VaultBundles
  private watcher: VaultWatcher
  /** The tree's facts of the files (shared, runnable components), read only when a file changed. */
  private facts = new VaultFacts()
  /** The notes' graph (tags, links, what their components work with), kept up to date in the background. */
  private graph: VaultGraph

  constructor(dataRoot: string, listen: VaultListeners) {
    this.root = join(dataRoot, 'vault')
    mkdirSync(this.root, { recursive: true })
    this.files = new VaultFiles(this.root)
    this.meta = new VaultMeta(this.files)
    this.runs = new VaultRuns(this.files)
    this.media = new VaultMedia(this.files, (needle) => this.usedBy(needle), (rel) => listen.onMedia([rel]))
    this.bundles = new VaultBundles(this.files, this.meta, this.runs, this.media, (dir, kind, name, text) => this.create(dir, kind, name, text))
    this.graph = new VaultGraph(dataRoot, { abs: (rel) => this.files.abs(rel), files: () => filesOf(this.tree()) })
    // a note changed outside is indexed again as a saved one is
    this.watcher = new VaultWatcher(
      this.files,
      (paths) => {
        for (const p of paths) this.graph.touched(p)
        listen.onChange(paths)
      },
      listen.onMedia,
    )
  }

  // ---------- marks ----------
  /** A colour mark (undefined — none). */
  setColor(rel: string, color?: string): void {
    this.meta.setColor(rel, color)
  }
  /** An emoji mark (undefined — none); it can stand together with the colour. */
  setEmoji(rel: string, emoji?: string): void {
    this.meta.setEmoji(rel, emoji)
  }
  /** A note and a board linked (b undefined — unlinked). */
  setPair(a: string, b?: string): void {
    this.meta.setPair(a, b)
  }

  /** The lines AI agents wrote in a personal note. */
  agentLines(rel: string): AgentLines {
    return this.meta.agentLinesOf(rel)
  }
  setAgentLines(rel: string, lines: AgentLines): void {
    this.meta.setAgentLines(rel, lines)
  }

  /** The AI's memory and journal of a personal note. */
  docAi(rel: string): DocAi {
    return this.meta.docAiOf(rel)
  }
  setDocAi(rel: string, ai: DocAi): void {
    this.meta.setDocAi(rel, ai)
  }

  // ---------- the runs of a runnable note ----------
  runRead(rel: string): string | undefined {
    return this.runs.read(rel)
  }
  runWrite(rel: string, json: string): void {
    this.runs.write(rel, json)
  }
  /** A block's files of its last run (screenshots, the trace…): vault/.runs/<note>/<block>/ (on disk). */
  runDir(rel: string, key: string): string {
    return this.runs.dir(rel, key)
  }
  /** The folder all the runs' files are under (the trace viewer gives nothing else). */
  get runsRoot(): string {
    return this.runs.root
  }
  /** Marks, links and runs follow a rename / move (`to` undefined — deleted: they go). */
  private remapMeta(from: string, to?: string): void {
    this.runs.remap(from, to)
    this.meta.remap(from, to)
  }

  // ---------- tree and files ----------
  tree(): VaultNode[] {
    return readVaultTree(this.files, this.meta, this.facts)
  }
  read(rel: string): string {
    return this.files.read(rel)
  }
  write(rel: string, text: string): void {
    this.files.write(rel, text)
    this.graph.touched(rel)
  }

  /** A new note / board / folder in `dir` with a free name ("Без названия", "Без названия 2", …). Returns its path. */
  create(dir: string, kind: VaultEntryKind, name?: string, text = ''): string {
    const base = this.files.abs(dir)
    mkdirSync(base, { recursive: true })
    const { name: def, ext } = NEW_KIND[kind]
    const file = this.files.freeFile(base, cleanName(name || def), ext)
    if (kind === 'folder') mkdirSync(file)
    else this.write(this.files.rel(file), text)
    return this.files.rel(file)
  }

  /** Rename / move a note or folder; the new path (a free one if taken). */
  move(from: string, toDir: string, name?: string): string {
    const src = this.files.abs(from)
    if (!existsSync(src)) throw new Error('Файл не найден')
    const isDir = statSync(src).isDirectory()
    const dst = this.files.abs(toDir)
    if (isDir && (dst === src || dst.startsWith(src + sep))) throw new Error('Нельзя переместить папку в саму себя')
    // a note stays .md, a board stays .qboard
    const ext = isDir ? '' : extname(src).toLowerCase() === BOARD_EXT ? BOARD_EXT : '.md'
    const want = cleanName(name ?? (isDir ? basename(src) : basename(src, ext)))
    const same = join(dst, want + ext)
    if (same.toLowerCase() === src.toLowerCase()) {
      if (same !== src) renameSync(src, same) // only the letter case changed
      this.graph.moved(this.files.rel(src), this.files.rel(same))
      return this.files.rel(same)
    }
    const file = this.files.freeFile(dst, want, ext)
    mkdirSync(dst, { recursive: true })
    renameSync(src, file)
    const before = this.files.rel(src)
    this.files.forgetUnder(before)
    this.remapMeta(before, this.files.rel(file))
    this.graph.moved(before, this.files.rel(file))
    return this.files.rel(file)
  }

  /** To the recycle bin (can be restored from there). */
  async remove(rel: string): Promise<void> {
    if (!rel) throw new Error('Нельзя удалить хранилище')
    const file = this.files.abs(rel)
    // the recordings of the notes go with them (when no other note embeds them)
    const gone = new Set<string>()
    const pics = new Set<string>()
    const collect = (p: string) => {
      try {
        const text = this.read(p)
        for (const a of audiosOf(text)) gone.add(a)
        for (const i of imagesOf(text)) pics.add(i)
      } catch {
        // unreadable — nothing to collect
      }
    }
    if (statSync(file).isDirectory()) {
      const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : collect(n.path)))
      walk(findNode(this.tree(), rel)?.children ?? [])
    } else collect(rel)
    await shell.trashItem(file)
    this.files.forgetUnder(rel)
    this.remapMeta(rel)
    this.graph.removed(rel)
    for (const a of gone) this.deleteAudio(a)
    for (const i of pics) this.deleteImage(i)
  }

  reveal(rel: string): void {
    const file = this.files.abs(rel)
    if (rel) shell.showItemInFolder(file)
    else void shell.openPath(file)
  }

  // ---------- search ----------
  /** Every event mentioned in the notes (qvarch://event/<day>/<id>): its id → the notes (paths). */
  eventMentions(): Record<string, string[]> {
    return eventMentions(this.tree(), (p) => this.read(p))
  }
  /** The notes that link to this one (`[[…]]`, a shared note's link). */
  backlinks(rel: string): string[] {
    return this.graph.backlinks(rel)
  }
  /** «Связи»: the notes linking here, and the related ones with why. */
  related(rel: string): { backlinks: string[]; related: RelatedNote[] } {
    return this.graph.related(rel)
  }
  /** Every tag of the notes with how many have it. */
  tags(): Array<{ name: string; label: string; count: number }> {
    return this.graph.tags()
  }
  /** The notes tagged so (nested tags too). */
  tagged(tag: string): string[] {
    return this.graph.tagged(tag)
  }
  /** The whole notebook as a graph to draw. */
  notebookGraph(): NotebookGraph {
    return this.graph.notebook()
  }
  /** A shared note's metadata by its document (where the shared states are kept; set once they are). */
  sharedMeta: (doc: string) => DocAi = () => NO_DOC_AI
  /**
   * All notes whose name or text has the query (any case), a few matching lines of each; the ones its graph finds
   * (`#тег`, a table, a request…) — with why; the ones whose metadata has it (the AI's memory, its turns) — with where.
   */
  search(q: string, limit = 60): VaultHit[] {
    const tree = this.tree()
    const hits = searchNotes(tree, (p) => this.read(p), q, limit)
    const add = (path: string, more: Pick<VaultHit, 'via' | 'meta'>) => {
      const hit = hits.find((h) => h.path === path)
      if (hit) Object.assign(hit, more)
      else if (hits.length < limit) hits.push({ path, name: basename(path, '.md'), inName: false, count: 0, lines: [], ...more })
    }
    for (const [path, via] of this.graph.search(q)) add(path, { via })
    const walk = (ns: VaultNode[]): void =>
      ns.forEach((n) => {
        if (n.dir) return walk(n.children ?? [])
        if (n.board) return
        const ai = n.doc ? this.sharedMeta(n.doc) : this.meta.docAiOf(n.path)
        const meta = ai.memory || ai.turns.length ? metaHits(ai, q) : []
        if (meta.length) add(n.path, { meta })
      })
    walk(tree)
    return hits
  }
  /** The notes and boards that have this text as it is (`limit` — at most this many found). */
  notesWith(needle: string, limit = Infinity): string[] {
    const out: string[] = []
    const walk = (ns: VaultNode[]): void => {
      for (const n of ns) {
        if (out.length >= limit) return
        if (n.dir) walk(n.children ?? [])
        else if (this.readOr(n.path).includes(needle)) out.push(n.path)
      }
    }
    walk(this.tree())
    return out
  }
  private readOr(rel: string): string {
    try {
      return this.read(rel)
    } catch {
      return ''
    }
  }
  /** Some note or board has this text. */
  private usedBy(needle: string): boolean {
    return this.notesWith(needle, 1).length > 0
  }

  // ---------- audio and pictures of the notes ----------
  saveAudio(bytes: Uint8Array): string {
    return this.media.saveAudio(bytes)
  }
  readAudio(rel: string): Uint8Array {
    return this.media.readAudio(rel)
  }
  deleteAudio(rel: string): boolean {
    return this.media.deleteAudio(rel)
  }
  restoreAudio(rel: string, bytes: Uint8Array): void {
    this.media.restoreAudio(rel, bytes)
  }
  saveImage(bytes: Uint8Array): string {
    return this.media.saveImage(bytes)
  }
  readImage(rel: string): Uint8Array {
    return this.media.readImage(rel)
  }
  deleteImage(rel: string): boolean {
    return this.media.deleteImage(rel)
  }
  restoreImage(rel: string, bytes: Uint8Array): void {
    this.media.restoreImage(rel, bytes)
  }
  clipImage(save: boolean): Promise<{ sig: string; rel?: string }> {
    return this.media.clipImage(save)
  }
  fetchImage(url: string): Promise<string> {
    return this.media.fetchImage(url)
  }

  // ---------- a document packed into one file (.qvdoc) and back ----------
  hasRuns(rel: string): boolean {
    return this.bundles.hasRuns(rel)
  }
  exportDoc(rel: string, withRuns: boolean, app?: string): { bundle: DocBundle; missing: string[] } {
    return this.bundles.exportDoc(rel, withRuns, app)
  }
  importDoc(b: DocBundle, dir: string): { main: string; paths: string[]; folder?: string } {
    return this.bundles.importDoc(b, dir)
  }

  // ---------- changes made outside (another editor, Explorer) ----------
  watch(): void {
    this.watcher.start()
    this.graph.start()
  }
  stop(): void {
    this.watcher.stop()
    this.graph.close()
  }
}
