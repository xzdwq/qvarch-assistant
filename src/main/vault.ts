import { shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import { audiosOf, type VaultHit, type VaultNode } from '../shared/vault'

const AUDIO_REL = /^\.audio\/[\w.-]+\.webm$/

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
  private meta: { colors: Record<string, string> }

  constructor(dataRoot: string, private onChange: (paths: string[]) => void) {
    this.root = join(dataRoot, 'vault')
    const fresh = !existsSync(this.root)
    mkdirSync(this.root, { recursive: true })
    if (fresh) writeFileSync(join(this.root, 'Начало.md'), WELCOME, 'utf8')
    try {
      this.meta = { colors: {}, ...JSON.parse(readFileSync(join(this.root, '.meta.json'), 'utf8')) }
    } catch {
      this.meta = { colors: {} }
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
  /** Marks follow a rename / move; a deleted thing loses its marks. */
  private remapMeta(from: string, to?: string): void {
    let changed = false
    for (const k of Object.keys(this.meta.colors)) {
      if (k !== from && !k.startsWith(from + '/')) continue
      const v = this.meta.colors[k]
      delete this.meta.colors[k]
      if (to !== undefined) this.meta.colors[to + k.slice(from.length)] = v
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
        const ctime = st.birthtimeMs || st.ctimeMs
        if (st.isDirectory()) out.push({ path: rel, name, dir: true, mtime: st.mtimeMs, ctime, color, children: walk(file) })
        else if (extname(name).toLowerCase() === '.md') out.push({ path: rel, name: name.slice(0, -3), dir: false, mtime: st.mtimeMs, ctime, color })
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

  /** A new note / folder in `dir` with a free name ("Без названия", "Без названия 2", …). Returns its path. */
  create(dir: string, kind: 'note' | 'folder', name?: string, text = ''): string {
    const base = this.abs(dir)
    mkdirSync(base, { recursive: true })
    const want = cleanName(name || (kind === 'note' ? 'Без названия' : 'Новая папка'))
    const ext = kind === 'note' ? '.md' : ''
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
    const ext = isDir ? '' : '.md'
    const want = cleanName(name ?? (isDir ? basename(src) : basename(src, '.md')))
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
    const collect = (p: string) => {
      try {
        for (const a of audiosOf(this.read(p))) gone.add(a)
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
  search(q: string, limit = 60): VaultHit[] {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const out: VaultHit[] = []
    const files: string[] = []
    const walk = (nodes: VaultNode[]) => nodes.forEach((n) => (n.dir ? walk(n.children ?? []) : files.push(n.path)))
    walk(this.tree())
    for (const path of files) {
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
    const embed = `![[${rel}]]`
    const walk = (ns: VaultNode[]): boolean =>
      ns.some((n) => {
        if (n.dir) return walk(n.children ?? [])
        try {
          return this.read(n.path).includes(embed)
        } catch {
          return false
        }
      })
    if (walk(this.tree())) return false
    rmSync(file, { force: true })
    return true
  }
  /** Puts a recording back (an undo brought its line back after it was deleted). */
  restoreAudio(rel: string, bytes: Uint8Array): void {
    if (!AUDIO_REL.test(rel)) throw new Error('Недопустимый путь')
    const file = this.abs(rel)
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, bytes)
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
