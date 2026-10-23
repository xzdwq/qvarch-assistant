import { shell } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, extname, join, sep } from 'node:path'
import { audiosOf, imagesOf, type VaultEntryKind, type VaultHit, type VaultNode } from '../shared/vault'
import { findNode } from '../shared/vaultTree'
import { BOARD_EXT } from '../shared/whiteboard'
import type { DocBundle } from '../shared/docBundle'
import { cleanName, VaultFiles } from './vault/vaultFiles'
import { VaultMeta } from './vault/vaultMeta'
import { VaultRuns } from './vault/vaultRuns'
import { VaultMedia } from './vault/vaultMedia'
import { VaultBundles } from './vault/vaultBundle'
import { VaultWatcher } from './vault/vaultWatcher'
import { readVaultTree } from './vault/vaultTree'
import { eventMentions, searchNotes } from './vault/vaultSearch'

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
export class Vault {
  readonly root: string
  private files: VaultFiles
  private meta: VaultMeta
  private runs: VaultRuns
  private media: VaultMedia
  private bundles: VaultBundles
  private watcher: VaultWatcher

  constructor(dataRoot: string, onChange: (paths: string[]) => void) {
    this.root = join(dataRoot, 'vault')
    mkdirSync(this.root, { recursive: true })
    this.files = new VaultFiles(this.root)
    this.meta = new VaultMeta(this.files)
    this.runs = new VaultRuns(this.files)
    this.media = new VaultMedia(this.files, (needle) => this.usedBy(needle))
    this.bundles = new VaultBundles(this.files, this.meta, this.runs, this.media, (dir, kind, name, text) => this.create(dir, kind, name, text))
    this.watcher = new VaultWatcher(this.files, onChange)
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
    return readVaultTree(this.files, this.meta)
  }
  read(rel: string): string {
    return this.files.read(rel)
  }
  write(rel: string, text: string): void {
    this.files.write(rel, text)
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
      return this.files.rel(same)
    }
    const file = this.files.freeFile(dst, want, ext)
    mkdirSync(dst, { recursive: true })
    renameSync(src, file)
    const before = this.files.rel(src)
    this.files.forgetUnder(before)
    this.remapMeta(before, this.files.rel(file))
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
  /** All notes whose name or text has the query (any case); a few matching lines of each. */
  search(q: string, limit = 60): VaultHit[] {
    return searchNotes(this.tree(), (p) => this.read(p), q, limit)
  }
  /** Some note or board has this text. */
  private usedBy(needle: string): boolean {
    const walk = (ns: VaultNode[]): boolean =>
      ns.some((n) => {
        if (n.dir) return walk(n.children ?? [])
        try {
          return this.read(n.path).includes(needle)
        } catch {
          return false
        }
      })
    return walk(this.tree())
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
  }
  stop(): void {
    this.watcher.stop()
  }
}
