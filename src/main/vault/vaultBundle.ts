import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { IMAGE_REL, type VaultEntryKind } from '../../shared/vault'
import { BOARD_EXT } from '../../shared/whiteboard'
import { assetsOf, boardsOf, BUNDLE_FORMAT, rebind, type BundleDoc, type DocBundle } from '../../shared/docBundle'
import type { VaultFiles } from './vaultFiles'
import type { VaultMeta } from './vaultMeta'
import type { VaultRuns } from './vaultRuns'
import { AUDIO_REL, type VaultMedia } from './vaultMedia'

/** What packing needs of the vault besides its parts: a new document / folder with a free name. */
export type CreateInVault = (dir: string, kind: VaultEntryKind, name?: string, text?: string) => string

const isBoardPath = (p: string) => p.toLowerCase().endsWith(BOARD_EXT)

/** A document packed into one file (.qvdoc) and back: with what comes with it, or a whole folder. */
export class VaultBundles {
  constructor(
    private files: VaultFiles,
    private meta: VaultMeta,
    private runs: VaultRuns,
    private media: VaultMedia,
    private create: CreateInVault,
  ) {}

  /** Whether the document (or what comes with it) has run results — to ask before packing them. */
  hasRuns(rel: string): boolean {
    return this.packList(rel).paths.some((p) => this.runs.read(p) !== undefined)
  }
  /**
   * What a bundle of `rel` holds: a document with what comes with it, or a whole folder — every note and board
   * in it (and what they bring from outside), its subfolders.
   */
  private packList(rel: string): { paths: string[]; folder?: { root: string; dirs: string[] } } {
    const file = this.files.abs(rel)
    if (!existsSync(file)) throw new Error('Файл не найден')
    if (!statSync(file).isDirectory()) return { paths: this.bundleDocs(rel) }
    const inside: string[] = []
    const dirs: string[] = []
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name.startsWith('.')) continue
        const p = join(d, name)
        const st = statSync(p)
        if (st.isDirectory()) {
          dirs.push(relative(file, p).split(sep).join('/'))
          walk(p)
        } else if (/\.(md|qboard)$/i.test(name)) inside.push(this.files.rel(p))
      }
    }
    walk(file)
    const paths: string[] = []
    for (const p of inside) for (const q of this.bundleDocs(p)) if (!paths.includes(q)) paths.push(q)
    return { paths, folder: { root: basename(file), dirs } }
  }
  /** The document and what comes with it: the boards it shows, its linked board / note (each once). */
  private bundleDocs(rel: string): string[] {
    const out: string[] = []
    const queue = [rel]
    while (queue.length) {
      const p = queue.shift()!
      if (out.includes(p) || !existsSync(this.files.abs(p)) || statSync(this.files.abs(p)).isDirectory()) continue
      out.push(p)
      const pair = this.meta.pairOf(p)
      if (pair) queue.push(pair)
      if (!isBoardPath(p)) queue.push(...boardsOf(this.files.read(p)).filter(isBoardPath))
    }
    return out
  }
  /** One document packed: its text, its runs (when asked), its marks, its place in the folder. */
  private packDoc(p: string, withRuns: boolean, inFolder: string | undefined): BundleDoc {
    const doc: BundleDoc = { key: p, kind: isBoardPath(p) ? 'board' : 'note', text: this.files.read(p) }
    const runs = withRuns ? this.runs.read(p) : undefined
    if (runs) {
      try {
        doc.runs = JSON.parse(runs)
      } catch {
        // a broken run file stays behind
      }
    }
    const color = this.meta.colorOf(p)
    const emoji = this.meta.emojiOf(p)
    if (color) doc.color = color
    if (emoji) doc.emoji = emoji
    // inside the folder: its place there
    if (inFolder !== undefined && p.startsWith(inFolder + '/')) doc.dir = p.slice(inFolder.length + 1).split('/').slice(0, -1).join('/')
    return doc
  }
  exportDoc(rel: string, withRuns: boolean, app?: string): { bundle: DocBundle; missing: string[] } {
    const { paths, folder } = this.packList(rel)
    const base = rel.replace(/\/+$/, '')
    const files: Record<string, string> = {}
    const missing: string[] = []
    const docs: BundleDoc[] = paths.map((p) => {
      const doc = this.packDoc(p, withRuns, folder ? base : undefined)
      for (const a of assetsOf(doc.text)) {
        if (files[a] !== undefined || missing.includes(a)) continue
        const f = this.files.abs(a)
        if (existsSync(f)) files[a] = readFileSync(f).toString('base64')
        else missing.push(a)
      }
      return doc
    })
    // the boards it shows that are gone
    for (const p of paths) for (const b of isBoardPath(p) ? [] : boardsOf(this.files.read(p))) if (!paths.includes(b) && !missing.includes(b)) missing.push(b)
    const pairs: Array<[string, string]> = []
    for (const p of paths) {
      const o = this.meta.pairOf(p)
      if (o && paths.includes(o) && !pairs.some(([a, b]) => b === p && a === o)) pairs.push([p, o])
    }
    const main = folder ? (paths[0] ?? '') : rel
    return { bundle: { format: BUNDLE_FORMAT, version: 1, exportedAt: new Date().toISOString(), app, main, ...(folder ? { root: folder.root, dirs: folder.dirs } : {}), docs, pairs, files }, missing }
  }
  /** The bundle's files into .images / .audio: the same name when free or the same bytes, else a new one (old → new). */
  private unpackFiles(b: DocBundle): Map<string, string> {
    const renamed = new Map<string, string>()
    for (const [a, data] of Object.entries(b.files)) {
      const audio = AUDIO_REL.test(a)
      if (!audio && !IMAGE_REL.test(a)) continue
      const bytes = Buffer.from(String(data), 'base64')
      const f = this.files.abs(a)
      if (existsSync(f)) {
        if (readFileSync(f).equals(bytes)) continue
        renamed.set(a, audio ? this.media.saveAudio(bytes) : this.media.saveImage(bytes))
      } else {
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, bytes)
      }
    }
    return renamed
  }
  /**
   * A bundle unpacked into `dir`: its documents get free names there, its files go to .images / .audio (the same
   * name when free or the same bytes, else a new one), the board paths and file names in the texts follow.
   * Returns the main document's new path and all the new paths.
   */
  importDoc(b: DocBundle, dir: string): { main: string; paths: string[]; folder?: string } {
    this.files.abs(dir)
    // a folder's bundle: the folder (a free name) and its subfolders first
    const top = b.root ? this.create(dir, 'folder', b.root) : undefined
    if (top) for (const d of b.dirs ?? []) mkdirSync(this.files.abs(`${top}/${d}`), { recursive: true })
    const placeOf = (d: BundleDoc) => (top ? (d.dir ? `${top}/${d.dir}` : top) : dir)
    const renamed = this.unpackFiles(b)
    // names first (boards before the notes that show them), then the texts with the new paths
    const order = [...b.docs].sort((x, y) => Number(x.kind === 'note') - Number(y.kind === 'note'))
    const moved = new Map<string, string>()
    for (const d of order) {
      const name = (d.key.split('/').pop() ?? '').replace(/\.(md|qboard)$/i, '') || undefined
      moved.set(d.key, this.create(placeOf(d), d.kind, name, ''))
    }
    for (const d of order) {
      const to = moved.get(d.key)!
      this.files.write(to, rebind(d.text, moved, renamed))
      if (d.runs !== undefined && d.kind === 'note') {
        try {
          this.runs.write(to, JSON.stringify(d.runs))
        } catch {
          // results too big — the note itself is what matters
        }
      }
      this.meta.markUnsaved(to, d)
    }
    for (const [x, y] of b.pairs) {
      const a = moved.get(x)
      const c = moved.get(y)
      if (a && c) this.meta.linkUnsaved(a, c)
    }
    this.meta.save()
    return { main: moved.get(b.main) ?? top ?? '', paths: [...moved.values()], ...(top ? { folder: top } : {}) }
  }
}
