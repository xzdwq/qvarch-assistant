import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** The text being saved, kept whole beside its note until the note is written (`.tmp`: the watcher and tree skip it). */
const sideOf = (file: string) => `${file}.tmp`

/**
 * The vault's files on disk: a vault path ("/" separated, relative) ↔ the file, nothing outside the vault; texts read
 * through a cache by mtime (search does not re-read unchanged files); what we wrote ourselves remembered (the watcher
 * does not report our own saves as outside changes).
 */
export class VaultFiles {
  /** path → text and mtime. */
  private cache = new Map<string, { mtime: number; text: string }>()
  /** path → the text we wrote. */
  private own = new Map<string, string>()

  constructor(readonly root: string) {}

  /** A vault path → the file on disk; nothing outside the vault. */
  abs(rel: string): string {
    const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
    const file = resolve(this.root, clean)
    if (file !== this.root && !file.startsWith(this.root + sep)) throw new Error('Недопустимый путь')
    return file
  }
  /** A file on disk → its vault path. */
  rel(file: string): string {
    return relative(this.root, file).split(sep).join('/')
  }

  read(rel: string): string {
    const file = this.abs(rel)
    this.recover(file)
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
    // in place: a temp file + rename would make a new file each time — and lose its creation date. The new text is
    // kept whole beside it first (itself written whole): a write cut short in place is put right on the next read
    const side = sideOf(file)
    writeFileSync(`${side}.part.tmp`, text, 'utf8')
    renameSync(`${side}.part.tmp`, side)
    writeFileSync(file, text, 'utf8')
    rmSync(side, { force: true })
    this.cache.set(rel, { mtime: statSync(file).mtimeMs, text })
  }
  /** A save that did not finish (the app or the computer went down): the note gets the text that was being saved. */
  private recover(file: string): void {
    const side = sideOf(file)
    if (!existsSync(side)) return
    writeFileSync(file, readFileSync(side, 'utf8'), 'utf8')
    rmSync(side, { force: true })
  }

  /** The cached texts of a path and everything under it forgotten (moved / deleted). */
  forgetUnder(rel: string): void {
    for (const k of [...this.cache.keys()]) if (k === rel || k.startsWith(rel + '/')) this.cache.delete(k)
  }
  /** One path's cached text forgotten (changed outside). */
  forget(rel: string): void {
    this.cache.delete(rel)
  }
  /** Is the file on disk what we wrote ourselves (then a change seen there is our own save)? */
  isOwnText(rel: string): boolean {
    const mine = this.own.get(rel)
    if (mine === undefined) return false
    try {
      return readFileSync(this.abs(rel), 'utf8') === mine
    } catch {
      // gone — a change
      return false
    }
  }

  /** A free file in `dir`: `want + ext`, else `want 2 + ext`, `want 3 + ext`… */
  freeFile(dir: string, want: string, ext: string): string {
    let n = 1
    let file = join(dir, want + ext)
    while (existsSync(file)) file = join(dir, `${want} ${++n}${ext}`)
    return file
  }
}

/** A file name without what Windows does not allow. */
export function cleanName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 120) || 'Без названия'
}
