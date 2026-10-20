import { clipboard, net, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import { audiosOf, IMAGE_REL, imagesOf, type VaultHit, type VaultNode } from '../shared/vault'
import { BOARD_EXT } from '../shared/whiteboard'
import { assetsOf, boardsOf, BUNDLE_FORMAT, rebind, type BundleDoc, type DocBundle } from '../shared/docBundle'

const AUDIO_REL = /^\.audio\/[\w.-]+\.webm$/

const MAX_IMAGE = 30 * 1024 * 1024
/** A picture's type by its first bytes. */
function imageType(b: Uint8Array): string | undefined {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  if (at(0, 0x42, 0x4d)) return 'bmp'
  return undefined
}

/**
 * The notebook: plain Markdown files in data/vault (folders are sections) — like an Obsidian vault, they can be
 * opened by any editor. Voice recordings of the notes go to vault/.audio (dot folders are not listed).
 * Paths between main and the renderer are relative to the vault, with "/" separators.
 */
export class Vault {
  readonly root: string
  /** path → text and mtime: search does not re-read unchanged files. */
  private cache = new Map<string, { mtime: number; text: string }>()
  /** What we wrote ourselves (path → text): the watcher does not report our own saves as outside changes. */
  private own = new Map<string, string>()
  private watcher?: FSWatcher
  private pending = new Set<string>()
  private timer?: NodeJS.Timeout
  /** User marks of notes / folders (path → colour), in vault/.meta.json. */
  private meta: { colors: Record<string, string>; pairs: Record<string, string>; emojis: Record<string, string> }

  constructor(dataRoot: string, private onChange: (paths: string[]) => void) {
    this.root = join(dataRoot, 'vault')
    const fresh = !existsSync(this.root)
    mkdirSync(this.root, { recursive: true })
    if (fresh) writeFileSync(join(this.root, 'Начало.md'), WELCOME, 'utf8')
    try {
      this.meta = { colors: {}, pairs: {}, emojis: {}, ...JSON.parse(readFileSync(join(this.root, '.meta.json'), 'utf8')) }
    } catch {
      this.meta = { colors: {}, pairs: {}, emojis: {} }
    }
  }
  private saveMeta(): void {
    const file = join(this.root, '.meta.json')
    writeFileSync(`${file}.tmp`, JSON.stringify(this.meta, null, 1), 'utf8')
    renameSync(`${file}.tmp`, file)
  }
  /** A colour mark (undefined — none). */
  setColor(rel: string, color?: string): void {
    this.abs(rel)
    if (color) this.meta.colors[rel] = color
    else delete this.meta.colors[rel]
    this.saveMeta()
  }
  /** An emoji mark (undefined — none); it can stand together with the colour. */
  setEmoji(rel: string, emoji?: string): void {
    this.abs(rel)
    if (emoji) this.meta.emojis[rel] = emoji
    else delete this.meta.emojis[rel]
    this.saveMeta()
  }
  /**
   * A note and a board linked (one view of the other): a .md with a .qboard, each with one partner; b undefined —
   * unlinked. Both directions are kept.
   */
  setPair(a: string, b?: string): void {
    const unlink = (p: string) => {
      const o = this.meta.pairs[p]
      if (o) delete this.meta.pairs[o]
      delete this.meta.pairs[p]
    }
    unlink(a)
    if (b) {
      const kinds = [a, b].map((p) => (p.toLowerCase().endsWith(BOARD_EXT) ? 'b' : p.toLowerCase().endsWith('.md') ? 'n' : '?')).sort().join('')
      if (kinds !== 'bn') throw new Error('Связать можно заметку с доской')
      if (!existsSync(this.abs(a)) || !existsSync(this.abs(b))) throw new Error('Файл не найден')
      unlink(b)
      this.meta.pairs[a] = b
      this.meta.pairs[b] = a
    }
    this.saveMeta()
  }

  /** Marks (and links) follow a rename / move; a deleted thing loses its marks and links. */
  // ---------- the runs of a runnable note (its context, its answers) — vault/.runs/<note>.json ----------
  private runFile(rel: string): string {
    this.abs(rel)
    return join(this.root, '.runs', `${rel}.json`)
  }
  runRead(rel: string): string | undefined {
    const f = this.runFile(rel)
    try {
      return existsSync(f) ? readFileSync(f, 'utf8') : undefined
    } catch {
      return undefined
    }
  }
  runWrite(rel: string, json: string): void {
    if (json.length > 16 * 1024 * 1024) throw new Error('Результаты больше 16 МБ — не сохраняются')
    const f = this.runFile(rel)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(`${f}.tmp`, json)
    renameSync(`${f}.tmp`, f)
  }
  /** A block's files of its last run (screenshots, the trace…): vault/.runs/<note>/<block>/ (on disk). */
  runDir(rel: string, key: string): string {
    this.abs(rel)
    const safe = String(key).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'block'
    return join(this.root, '.runs', rel, safe)
  }
  /** The folder all the runs' files are under (the trace viewer gives nothing else). */
  get runsRoot(): string {
    return join(this.root, '.runs')
  }
  private remapMeta(from: string, to?: string): void {
    // the runs go with their note / folder
    const rf = join(this.root, '.runs', from)
    for (const [p, ext] of [[`${rf}.json`, '.json'], [rf, '']] as const) {
      if (!existsSync(p)) continue
      try {
        if (to === undefined) rmSync(p, { recursive: true, force: true })
        else {
          const t = join(this.root, '.runs', to) + ext
          mkdirSync(dirname(t), { recursive: true })
          renameSync(p, t)
        }
      } catch {
        // a run kept or lost — the note itself is what matters
      }
    }
    let changed = false
    const pairs: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.meta.pairs)) {
      const nk = k === from || k.startsWith(from + '/') ? (to === undefined ? undefined : to + k.slice(from.length)) : k
      const nv = v === from || v.startsWith(from + '/') ? (to === undefined ? undefined : to + v.slice(from.length)) : v
      if (nk !== k || nv !== v) changed = true
      if (nk && nv) pairs[nk] = nv
    }
    this.meta.pairs = pairs
    for (const map of [this.meta.colors, this.meta.emojis])
      for (const k of Object.keys(map)) {
        if (k !== from && !k.startsWith(from + '/')) continue
        const v = map[k]
        delete map[k]
        if (to !== undefined) map[to + k.slice(from.length)] = v
        changed = true
      }
    if (changed) this.saveMeta()
  }

  /** A vault path → the file on disk; nothing outside the vault. */
  private abs(rel: string): string {
    const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    const file = resolve(this.root, clean)
    if (file !== this.root && !file.startsWith(this.root + sep)) throw new Error('Недопустимый путь')
    return file
  }
  private rel(file: string): string {
    return relative(this.root, file).split(sep).join('/')
  }

  // ---------- tree ----------
  tree(): VaultNode[] {
    const walk = (dir: string): VaultNode[] => {
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        return []
      }
      const out: VaultNode[] = []
      for (const name of names) {
        if (name.startsWith('.')) continue
        const file = join(dir, name)
        let st
        try {
          st = statSync(file)
        } catch {
          continue
        }
        const rel = this.rel(file)
        const color = this.meta.colors[rel]
        const emoji = this.meta.emojis[rel]
        const ctime = st.birthtimeMs || st.ctimeMs
        if (st.isDirectory()) out.push({ path: rel, name, dir: true, mtime: st.mtimeMs, ctime, color, emoji, children: walk(file) })
        else if (extname(name).toLowerCase() === '.md') out.push({ path: rel, name: name.slice(0, -3), dir: false, mtime: st.mtimeMs, ctime, color, emoji, pair: this.meta.pairs[rel] })
        else if (extname(name).toLowerCase() === BOARD_EXT) out.push({ path: rel, name: name.slice(0, -BOARD_EXT.length), dir: false, mtime: st.mtimeMs, ctime, color, emoji, board: true, pair: this.meta.pairs[rel] })
      }
      // folders first, then by name (numbers in natural order)
      return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'ru', { numeric: true })))
    }
    return walk(this.root)
  }

  // ---------- files ----------
  read(rel: string): string {
    const file = this.abs(rel)
    const st = statSync(file)
    const c = this.cache.get(rel)
    if (c && c.mtime === st.mtimeMs) return c.text
    const text = readFileSync(file, 'utf8')
    this.cache.set(rel, { mtime: st.mtimeMs, text })
    return text
  }

  write(rel: string, text: string): void {
    const file = this.abs(rel)
    mkdirSync(dirname(file), { recursive: true })
    this.own.set(rel, text)
    // in place: a temp file + rename would make a new file each time — and lose its creation date
    writeFileSync(file, text, 'utf8')
    this.cache.set(rel, { mtime: statSync(file).mtimeMs, text })
  }

  /** A new note / board / folder in `dir` with a free name ("Без названия", "Без названия 2", …). Returns its path. */
  create(dir: string, kind: 'note' | 'folder' | 'board', name?: string, text = ''): string {
    const base = this.abs(dir)
    mkdirSync(base, { recursive: true })
    const want = cleanName(name || (kind === 'note' ? 'Без названия' : kind === 'board' ? 'Доска' : 'Новая папка'))
    const ext = kind === 'note' ? '.md' : kind === 'board' ? BOARD_EXT : ''
    let n = 1
    let file = join(base, want + ext)
    while (existsSync(file)) file = join(base, `${want} ${++n}${ext}`)
    if (kind === 'folder') mkdirSync(file)
    else this.write(this.rel(file), text)
    return this.rel(file)
  }

  /** Rename / move a note or folder; the new path (a free one if taken). */
  move(from: string, toDir: string, name?: string): string {
    const src = this.abs(from)
    if (!existsSync(src)) throw new Error('Файл не найден')
    const isDir = statSync(src).isDirectory()
    const dst = this.abs(toDir)
    if (isDir && (dst === src || dst.startsWith(src + sep))) throw new Error('Нельзя переместить папку в саму себя')
    // a note stays .md, a board stays .qboard
    const ext = isDir ? '' : extname(src).toLowerCase() === BOARD_EXT ? BOARD_EXT : '.md'
    const want = cleanName(name ?? (isDir ? basename(src) : basename(src, ext)))
    let file = join(dst, want + ext)
    if (file.toLowerCase() === src.toLowerCase()) {
      if (file !== src) renameSync(src, file) // only the letter case changed
      return this.rel(file)
    }
    let n = 1
    while (existsSync(file)) file = join(dst, `${want} ${++n}${ext}`)
    mkdirSync(dst, { recursive: true })
    renameSync(src, file)
    const before = this.rel(src)
    for (const k of [...this.cache.keys()]) if (k === before || k.startsWith(before + '/')) this.cache.delete(k)
    this.remapMeta(before, this.rel(file))
    return this.rel(file)
  }

  /** To the recycle bin (can be restored from there). */
  async remove(rel: string): Promise<void> {
    if (!rel) throw new Error('Нельзя удалить хранилище')
    const file = this.abs(rel)
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
      walk(this.find(rel)?.children ?? [])
    } else collect(rel)
    await shell.trashItem(file)
    for (const k of [...this.cache.keys()]) if (k === rel || k.startsWith(rel + '/')) this.cache.delete(k)
    this.remapMeta(rel)
    for (const a of gone) this.deleteAudio(a)
    for (const i of pics) this.deleteImage(i)
  }
  private find(rel: string): VaultNode | undefined {
    const walk = (ns: VaultNode[]): VaultNode | undefined => {
      for (const n of ns) {
        if (n.path === rel) return n
        const c = n.dir ? walk(n.children ?? []) : undefined
        if (c) return c
      }
    }
    return walk(this.tree())
  }

  reveal(rel: string): void {
    const file = this.abs(rel)
    if (rel) shell.showItemInFolder(file)
    else void shell.openPath(file)
  }

  // ---------- search ----------
  /** All notes whose name or text has the query (any case); a few matching lines of each. */
  /** Every event mentioned in the notes (qvarch://event/<day>/<id>): its id → the notes (paths). */
  eventMentions(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    const walk = (ns: VaultNode[]) => {
      for (const n of ns) {
        if (n.dir) {
          walk(n.children ?? [])
          continue
        }
        if (n.board) continue
        let text: string
        try {
          text = this.read(n.path)
        } catch {
          continue
        }
        if (!text.includes('qvarch://event/')) continue
        for (const m of text.matchAll(/qvarch:\/\/event\/\d{4}-\d{2}-\d{2}\/([\w-]+)/g)) {
          const list = (out[m[1]] ??= [])
          if (!list.includes(n.path)) list.push(n.path)
        }
      }
    }
    walk(this.tree())
    return out
  }
  search(q: string, limit = 60): VaultHit[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const out: VaultHit[] = []
    const files: string[] = []
    const walk = (nodes: VaultNode[]) => nodes.forEach((n) => (n.dir ? walk(n.children ?? []) : files.push(n.path)))
    walk(this.tree())
    for (const path of files) {
      // a board: found by its name only (its file is drawing data, not text)
      if (path.toLowerCase().endsWith(BOARD_EXT)) {
        const bn = posix.basename(path, BOARD_EXT)
        if (bn.toLowerCase().includes(needle)) out.push({ path, name: bn, inName: true, count: 0, lines: [] })
        continue
      }
      let text: string
      try {
        text = this.read(path)
      } catch {
        continue
      }
      const name = posix.basename(path, '.md')
      const lines: VaultHit['lines'] = []
      let count = 0
      const low = text.toLowerCase()
      let at = low.indexOf(needle)
      while (at >= 0) {
        count++
        if (lines.length < 5) {
          const ls = text.lastIndexOf('\n', at - 1) + 1
          const le = text.indexOf('\n', at)
          const line = text.slice(ls, le < 0 ? undefined : le)
          const lineNo = text.slice(0, ls).split('\n').length - 1
          if (!lines.some((l) => l.line === lineNo)) {
            // a window around the match
            const col = at - ls
            const from = Math.max(0, col - 40)
            lines.push({ line: lineNo, col, len: needle.length, text: (from ? '…' : '') + line.slice(from, col + needle.length + 80), at: col - from + (from ? 1 : 0) })
          }
        }
        at = low.indexOf(needle, at + needle.length)
      }
      const inName = name.toLowerCase().includes(needle)
      if (count || inName) out.push({ path, name, inName, count, lines })
      if (out.length >= limit) break
    }
    // the name first, then how often
    return out.sort((a, b) => Number(b.inName) - Number(a.inName) || b.count - a.count)
  }

  // ---------- audio of the notes ----------
  saveAudio(bytes: Uint8Array): string {
    const rel = `.audio/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.webm`
    const file = this.abs(rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    return rel
  }
  readAudio(rel: string): Uint8Array {
    if (!AUDIO_REL.test(rel)) throw new Error('Недопустимый путь')
    return readFileSync(this.abs(rel))
  }
  /** Deletes a recording from the disk — unless some note still embeds it. Returns whether it was deleted. */
  deleteAudio(rel: string): boolean {
    if (!AUDIO_REL.test(rel)) throw new Error('Недопустимый путь')
    const file = this.abs(rel)
    if (!existsSync(file)) return false
    if (this.usedBy(`![[${rel}]]`)) return false
    rmSync(file, { force: true })
    return true
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

  // ---------- pictures of the notes and the boards ----------
  /** A picture's bytes → vault/.images (its type by the bytes, not by a name). */
  saveImage(bytes: Uint8Array): string {
    if (bytes.byteLength > MAX_IMAGE) throw new Error(`Изображение больше ${MAX_IMAGE / 1024 / 1024} МБ`)
    const ext = imageType(bytes)
    if (!ext) throw new Error('Это не изображение (поддерживаются PNG, JPEG, GIF, WebP, BMP)')
    const rel = `.images/${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.${ext}`
    const file = this.abs(rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
    return rel
  }
  readImage(rel: string): Uint8Array {
    if (!IMAGE_REL.test(rel)) throw new Error('Недопустимый путь')
    return readFileSync(this.abs(rel))
  }
  /** Deletes a picture from the disk — unless some note or board still has it. Returns whether it was deleted. */
  deleteImage(rel: string): boolean {
    if (!IMAGE_REL.test(rel)) throw new Error('Недопустимый путь')
    const file = this.abs(rel)
    if (!existsSync(file)) return false
    if (this.usedBy(rel)) return false
    rmSync(file, { force: true })
    return true
  }
  /** Puts a picture back (an undo brought it back after it was deleted). */
  restoreImage(rel: string, bytes: Uint8Array): void {
    if (!IMAGE_REL.test(rel)) throw new Error('Недопустимый путь')
    const file = this.abs(rel)
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  /**
   * The picture on the clipboard: its signature ('' — none) and, when asked, saved to the vault.
   * (The signature tells a picture copied after the board's own Ctrl+C from the one that was there before.)
   */
  async clipImage(save: boolean): Promise<{ sig: string; rel?: string }> {
    if (!(await clipboard.has('image/png'))) return { sig: '' }
    const item = (await clipboard.read()).find((i) => i.types.includes('image/png'))
    const blob = item ? await item.getType('image/png').catch(() => undefined) : undefined
    if (!(blob instanceof Blob)) return { sig: '' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!bytes.byteLength) return { sig: '' }
    const sig = createHash('sha1').update(bytes).digest('hex').slice(0, 16)
    return save ? { sig, rel: this.saveImage(bytes) } : { sig }
  }
  /** A picture dragged from a web page (its address): downloaded into the vault. */
  async fetchImage(url: string): Promise<string> {
    if (url.startsWith('data:image/')) {
      const m = /^data:image\/[\w.+-]+;base64,(.*)$/s.exec(url)
      if (!m) throw new Error('Не удалось прочитать изображение')
      return this.saveImage(Buffer.from(m[1], 'base64'))
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('Можно взять изображение только по ссылке http(s)')
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 20_000)
    try {
      const r = await net.fetch(url, { signal: ctl.signal })
      if (!r.ok) throw new Error(`Сайт ответил ${r.status}`)
      const len = Number(r.headers.get('content-length') ?? 0)
      if (len > MAX_IMAGE) throw new Error(`Изображение больше ${MAX_IMAGE / 1024 / 1024} МБ`)
      return this.saveImage(new Uint8Array(await r.arrayBuffer()))
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'Изображение не загрузилось за 20 секунд' : e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(t)
    }
  }
  /** Puts a recording back (an undo brought its line back after it was deleted). */
  restoreAudio(rel: string, bytes: Uint8Array): void {
    if (!AUDIO_REL.test(rel)) throw new Error('Недопустимый путь')
    const file = this.abs(rel)
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }

  // ---------- a document packed into one file (.qvdoc) and back ----------
  /** Whether the document (or what comes with it) has run results — to ask before packing them. */
  hasRuns(rel: string): boolean {
    return this.packList(rel).paths.some((p) => this.runRead(p) !== undefined)
  }
  /**
   * What a bundle of `rel` holds: a document with what comes with it, or a whole folder — every note and board
   * in it (and what they bring from outside), its subfolders.
   */
  private packList(rel: string): { paths: string[]; folder?: { root: string; dirs: string[] } } {
    const file = this.abs(rel)
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
        } else if (/\.(md|qboard)$/i.test(name)) inside.push(this.rel(p))
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
      if (out.includes(p) || !existsSync(this.abs(p)) || statSync(this.abs(p)).isDirectory()) continue
      out.push(p)
      const pair = this.meta.pairs[p]
      if (pair) queue.push(pair)
      if (!p.toLowerCase().endsWith(BOARD_EXT)) queue.push(...boardsOf(this.read(p)).filter((b) => b.toLowerCase().endsWith(BOARD_EXT)))
    }
    return out
  }
  exportDoc(rel: string, withRuns: boolean, app?: string): { bundle: DocBundle; missing: string[] } {
    const { paths, folder } = this.packList(rel)
    const base = rel.replace(/\/+$/, '')
    const files: Record<string, string> = {}
    const missing: string[] = []
    const docs: BundleDoc[] = paths.map((p) => {
      const text = this.read(p)
      for (const a of assetsOf(text)) {
        if (files[a] !== undefined || missing.includes(a)) continue
        const f = this.abs(a)
        if (existsSync(f)) files[a] = readFileSync(f).toString('base64')
        else missing.push(a)
      }
      const doc: BundleDoc = { key: p, kind: p.toLowerCase().endsWith(BOARD_EXT) ? 'board' : 'note', text }
      const runs = withRuns ? this.runRead(p) : undefined
      if (runs) {
        try {
          doc.runs = JSON.parse(runs)
        } catch {
          // a broken run file stays behind
        }
      }
      if (this.meta.colors[p]) doc.color = this.meta.colors[p]
      if (this.meta.emojis[p]) doc.emoji = this.meta.emojis[p]
      // inside the folder: its place there
      if (folder && p.startsWith(base + '/')) doc.dir = p.slice(base.length + 1).split('/').slice(0, -1).join('/')
      return doc
    })
    // the boards it shows that are gone
    for (const p of paths) for (const b of p.toLowerCase().endsWith(BOARD_EXT) ? [] : boardsOf(this.read(p))) if (!paths.includes(b) && !missing.includes(b)) missing.push(b)
    const pairs: Array<[string, string]> = []
    for (const p of paths) {
      const o = this.meta.pairs[p]
      if (o && paths.includes(o) && !pairs.some(([a, b]) => b === p && a === o)) pairs.push([p, o])
    }
    const main = folder ? (paths[0] ?? '') : rel
    return { bundle: { format: BUNDLE_FORMAT, version: 1, exportedAt: new Date().toISOString(), app, main, ...(folder ? { root: folder.root, dirs: folder.dirs } : {}), docs, pairs, files }, missing }
  }
  /**
   * A bundle unpacked into `dir`: its documents get free names there, its files go to .images / .audio (the same
   * name when free or the same bytes, else a new one), the board paths and file names in the texts follow.
   * Returns the main document's new path and all the new paths.
   */
  importDoc(b: DocBundle, dir: string): { main: string; paths: string[]; folder?: string } {
    this.abs(dir)
    // a folder's bundle: the folder (a free name) and its subfolders first
    const top = b.root ? this.create(dir, 'folder', b.root) : undefined
    if (top) for (const d of b.dirs ?? []) mkdirSync(this.abs(`${top}/${d}`), { recursive: true })
    const placeOf = (d: BundleDoc) => (top ? (d.dir ? `${top}/${d.dir}` : top) : dir)
    const renamed = new Map<string, string>()
    for (const [a, data] of Object.entries(b.files)) {
      const audio = AUDIO_REL.test(a)
      if (!audio && !IMAGE_REL.test(a)) continue
      const bytes = Buffer.from(String(data), 'base64')
      const f = this.abs(a)
      if (existsSync(f)) {
        if (readFileSync(f).equals(bytes)) continue
        renamed.set(a, audio ? this.saveAudio(bytes) : this.saveImage(bytes))
      } else {
        mkdirSync(dirname(f), { recursive: true })
        writeFileSync(f, bytes)
      }
    }
    // names first (boards before the notes that show them), then the texts with the new paths
    const order = [...b.docs].sort((x, y) => Number(x.kind === 'note') - Number(y.kind === 'note'))
    const moved = new Map<string, string>()
    for (const d of order) {
      const name = (d.key.split('/').pop() ?? '').replace(/\.(md|qboard)$/i, '') || undefined
      moved.set(d.key, this.create(placeOf(d), d.kind, name, ''))
    }
    for (const d of order) {
      const to = moved.get(d.key)!
      this.write(to, rebind(d.text, moved, renamed))
      if (d.runs !== undefined && d.kind === 'note') {
        try {
          this.runWrite(to, JSON.stringify(d.runs))
        } catch {
          // results too big — the note itself is what matters
        }
      }
      if (typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color)) this.meta.colors[to] = d.color
      if (typeof d.emoji === 'string' && d.emoji.length <= 16) this.meta.emojis[to] = d.emoji
    }
    for (const [x, y] of b.pairs) {
      const a = moved.get(x)
      const c = moved.get(y)
      if (a && c) {
        this.meta.pairs[a] = c
        this.meta.pairs[c] = a
      }
    }
    this.saveMeta()
    return { main: moved.get(b.main) ?? top ?? '', paths: [...moved.values()], ...(top ? { folder: top } : {}) }
  }

  // ---------- changes made outside (another editor, Explorer) ----------
  watch(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_ev, name) => {
        if (!name) return
        const rel = String(name).split(sep).join('/')
        if (rel.split('/').some((p) => p.startsWith('.')) || rel.endsWith('.tmp')) return
        this.pending.add(rel)
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flushChanges(), 250)
      })
    } catch {
      // no watching on this system — the tree refreshes on our own actions only
    }
  }
  private flushChanges(): void {
    const paths: string[] = []
    for (const rel of this.pending) {
      // our own save: same text on disk → not a change
      const mine = this.own.get(rel)
      if (mine !== undefined) {
        try {
          if (readFileSync(this.abs(rel), 'utf8') === mine) continue
        } catch {
          // gone — report
        }
      }
      this.cache.delete(rel)
      paths.push(rel)
    }
    this.pending.clear()
    if (paths.length) this.onChange(paths)
  }
  stop(): void {
    this.watcher?.close()
  }
}

/** A file name without what Windows does not allow. */
function cleanName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'Без названия'
}

const WELCOME = `# Блокнот

Здесь — обычные Markdown-файлы (папка «vault» в данных приложения): их можно открыть и в любом другом редакторе.

- **Разделы** — это папки: создавайте их кнопками слева или правым кликом по дереву.
- **Вкладки** — клик по заметке открывает её, средняя кнопка мыши закрывает вкладку.
- **Два окна рядом** — кнопка «Разделить» над заметкой или \`Ctrl+\\\`.
- **Поиск по всем заметкам** — лупа слева или Ctrl+Shift+F.
- **Голос** — кнопка микрофона вставляет запись прямо в заметку и расшифровывает её локально.
- Сохраняется само, пока вы пишете.

Ссылка на другую заметку: [[Начало]].
`
