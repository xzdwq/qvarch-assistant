/**
 * A notebook document packed into one file (.qvdoc) — to open it on another machine as it is: the note (or the
 * board) with its pictures, voice recordings, the boards it shows (```board path: …) and its linked board, and —
 * when asked — the results of its runs (the context, the answers). HTTP and code blocks are in the text itself.
 */
import { imagesOf } from './vault'

export const BUNDLE_EXT = 'qvdoc'
export const BUNDLE_FORMAT = 'qvarch-doc'
/** The whole file at most (the pictures are inside, base64). */
export const MAX_BUNDLE = 300 * 1024 * 1024

/** What a packed document is: a note or a board. */
export const BUNDLE_DOC_KINDS = ['note', 'board'] as const
export type BundleDocKind = (typeof BUNDLE_DOC_KINDS)[number]
export interface BundleDoc {
  /** Its path in the vault it came from — the key the others refer to it by. */
  key: string
  kind: BundleDocKind
  text: string
  /** vault/.runs/<note>.json as it was (only when exported with results). */
  runs?: unknown
  color?: string
  emoji?: string
  /** A folder's bundle: where it lies inside the folder ('' — at its top; none — came along from outside). */
  dir?: string
}
export interface DocBundle {
  format: typeof BUNDLE_FORMAT
  version: 1
  exportedAt: string
  app?: string
  /** The key of the document that was exported (the others came with it); a folder's bundle — its first one or ''. */
  main: string
  /** A whole folder: its name and its subfolders (relative, empty ones too). */
  root?: string
  dirs?: string[]
  docs: BundleDoc[]
  /** Linked note ↔ board (keys). */
  pairs: Array<[string, string]>
  /** .images/… and .audio/… → base64. */
  files: Record<string, string>
}

const AUDIO_ANY = /\.audio\/[\w.-]+\.webm/g
/** A board component's `path:` line (with everything before it from its fence): head, fence, path, tail. */
const BOARD_PATH = /^([ \t]*(`{3,}|~{3,})[ \t]*board\b[^\n]*\n(?:(?![ \t]*\2)[^\n]*\n)*?[ \t]*path[ \t]*:[ \t]*)([^\n]*?)([ \t]*)$/gim

/** The files (pictures, recordings) a text has. */
export function assetsOf(text: string): string[] {
  return [...new Set([...imagesOf(text), ...(text.match(AUDIO_ANY) ?? [])])]
}
/** The boards a note shows (their vault paths). */
export function boardsOf(text: string): string[] {
  return [...new Set([...text.matchAll(BOARD_PATH)].map((m) => m[3].trim()).filter(Boolean))]
}
/** A text with its boards' paths and its files' names changed (`boards`: old → new; `files`: old → new). */
export function rebind(text: string, boards: Map<string, string>, files: Map<string, string>): string {
  let out = text.replace(BOARD_PATH, (m, head: string, _f: string, p: string, tail: string) => {
    const to = boards.get(p.trim())
    return to ? `${head}${to}${tail}` : m
  })
  for (const [a, b] of files) if (a !== b) out = out.split(a).join(b)
  return out
}

/** The file read back: a bundle, or what is wrong with it. */
export function parseBundle(json: string): DocBundle {
  let b: Partial<DocBundle>
  try {
    b = JSON.parse(json)
  } catch {
    throw new Error('Файл повреждён: это не JSON')
  }
  if (!b || b.format !== BUNDLE_FORMAT) throw new Error('Это не документ Qvarch (.qvdoc)')
  if (b.version !== 1) throw new Error(`Версия документа ${String(b.version)} не поддерживается — обновите приложение`)
  const folder = typeof b.root === 'string' && !!b.root.trim()
  if (!Array.isArray(b.docs) || (!b.docs.length && !folder)) throw new Error('В файле нет документов')
  for (const d of b.docs) {
    if (!d || typeof d.key !== 'string' || typeof d.text !== 'string' || !(BUNDLE_DOC_KINDS as readonly unknown[]).includes(d.kind)) throw new Error('Файл повреждён: неверный документ')
  }
  if (typeof b.main !== 'string' || (!folder && !b.docs.some((d) => d.key === b.main))) throw new Error('Файл повреждён: нет основного документа')
  const safeRel = (p: unknown) => typeof p === 'string' && !/(^|\/)\.\.?(\/|$)/.test(p) && !/^[\\/]|:/.test(p)
  return {
    format: BUNDLE_FORMAT,
    version: 1,
    exportedAt: String(b.exportedAt ?? ''),
    app: b.app,
    main: b.main,
    ...(folder ? { root: b.root!.trim(), dirs: Array.isArray(b.dirs) ? b.dirs.filter(safeRel) : [] } : {}),
    docs: b.docs.map((d) => (d.dir !== undefined && !safeRel(d.dir) && d.dir !== '' ? { ...d, dir: '' } : d)),
    pairs: Array.isArray(b.pairs) ? b.pairs.filter((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string')) : [],
    files: b.files && typeof b.files === 'object' ? b.files : {},
  }
}
