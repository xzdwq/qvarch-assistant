import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { SPACE_LINK_FILE } from '../../shared/transport/space'
import { SHARED_FORMATS } from '../../shared/transport/sharedFormats'
import type { SharedFolderLink } from '../../shared/transport/sharedFolder'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A file's first bytes as text (its mark is there). */
function readHead(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const b = Buffer.alloc(120)
    return b.toString('utf8', 0, readSync(fd, b, 0, 120, 0))
  } finally {
    closeSync(fd)
  }
}

/**
 * What this computer keeps of the shared notes: each document's state (Yjs, as the window gives it — what was edited
 * offline reaches the server later; a change of the note's file meanwhile is told apart from the others' edits), and
 * each shared folder's link — a dot file in the folder itself (it moves with the folder): its space and where each of
 * its documents was last time (a move or a deletion is told as this person's or the others').
 */
export class SharedStates {
  private readonly dir: string
  constructor(
    root: string,
    private readonly vaultRoot: string,
  ) {
    this.dir = join(root, 'shared')
  }
  /** A document's file (an id that is not one — refused: it names a file). */
  private file(doc: string): string {
    if (!UUID.test(doc)) throw new Error('Неверный идентификатор документа')
    return join(this.dir, `${doc}.ystate`)
  }
  load(doc: string): string {
    const f = this.file(doc)
    return existsSync(f) ? readFileSync(f).toString('base64') : ''
  }
  save(doc: string, state: string): void {
    const f = this.file(doc)
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${f}.tmp`, Buffer.from(state, 'base64'))
    renameSync(`${f}.tmp`, f)
  }

  /** A folder of the notebook (outside it — refused). */
  private folder(dir: string): string {
    const abs = resolve(this.vaultRoot, dir)
    if (abs !== resolve(this.vaultRoot) && !abs.startsWith(resolve(this.vaultRoot) + sep)) throw new Error('Папка вне блокнота')
    return abs
  }
  /** Every shared folder of the notebook with its link. */
  links(): SharedFolderLink[] {
    const out: SharedFolderLink[] = []
    const walk = (abs: string) => {
      let names: string[]
      try {
        names = readdirSync(abs)
      } catch {
        return
      }
      if (names.includes(SPACE_LINK_FILE)) {
        try {
          const l = JSON.parse(readFileSync(join(abs, SPACE_LINK_FILE), 'utf8')) as Omit<SharedFolderLink, 'dir'>
          if (UUID.test(l.space)) out.push({ space: l.space, docs: l.docs ?? {}, dir: relative(this.vaultRoot, abs).split(sep).join('/') })
        } catch {
          // a broken link — not a shared folder
        }
      }
      for (const n of names) if (!n.startsWith('.') && statSync(join(abs, n), { throwIfNoEntry: false })?.isDirectory()) walk(join(abs, n))
    }
    walk(this.vaultRoot)
    return out
  }
  /**
   * The file of the notebook that is this shared document (by its mark — a note's first line, a board's JSON start;
   * never by its name: someone may have a file of the same name of their own). None — ''.
   */
  find(doc: string): string {
    if (!UUID.test(doc)) return ''
    const marks = Object.values(SHARED_FORMATS).map((f) => f.head(doc))
    const walk = (abs: string): string => {
      let names: string[]
      try {
        names = readdirSync(abs)
      } catch {
        return ''
      }
      for (const n of names) {
        if (n.startsWith('.')) continue
        const f = join(abs, n)
        const st = statSync(f, { throwIfNoEntry: false })
        if (st?.isDirectory()) {
          const hit = walk(f)
          if (hit) return hit
        } else if (st && Object.hasOwn(SHARED_FORMATS, extname(n).toLowerCase())) {
          const head = readHead(f)
          if (marks.some((m) => head.startsWith(m))) return relative(this.vaultRoot, f).split(sep).join('/')
        }
      }
      return ''
    }
    return walk(this.vaultRoot)
  }
  /** A folder's link kept (none — the folder is no longer shared). */
  writeLink(dir: string, link: Omit<SharedFolderLink, 'dir'> | null): void {
    const f = join(this.folder(dir), SPACE_LINK_FILE)
    if (!link) return rmSync(f, { force: true })
    writeFileSync(`${f}.tmp`, JSON.stringify({ space: link.space, docs: link.docs }, null, 2))
    renameSync(`${f}.tmp`, f)
  }
}
