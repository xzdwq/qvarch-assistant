/** A server's folder as the file explorer shows it: its entries, folders first, the rights as `ls -l` writes them. */

export const REMOTE_KINDS = ['dir', 'file', 'link'] as const
export type RemoteKind = (typeof REMOTE_KINDS)[number]

export interface RemoteEntry {
  name: string
  path: string
  kind: RemoteKind
  size: number
  /** Last change, ms. */
  mtime: number
  /** The rights: 'rwxr-xr-x'. */
  rights: string
  /** A link that leads to a folder (opened as one). */
  toDir?: boolean
}
export interface RemoteListing {
  path: string
  entries: RemoteEntry[]
  /** More entries were there than are shown. */
  cut?: number
}
/** At most this many entries of a folder are shown. */
export const LISTING_MAX = 5000

/** The file type bits of a mode (S_IFMT) → what the entry is. */
export function kindOfMode(mode: number): RemoteKind {
  const t = mode & 0o170000
  if (t === 0o040000) return 'dir'
  if (t === 0o120000) return 'link'
  return 'file'
}

/** The permission bits as `rwxr-xr-x` (setuid / setgid / sticky shown as s / t, as ls does). */
export function rightsOf(mode: number): string {
  const bit = (m: number, ch: string) => (mode & m ? ch : '-')
  const x = (m: number, special: number, on: string, off: string) => (mode & special ? (mode & m ? on : off) : bit(m, 'x'))
  return [bit(0o400, 'r'), bit(0o200, 'w'), x(0o100, 0o4000, 's', 'S'), bit(0o040, 'r'), bit(0o020, 'w'), x(0o010, 0o2000, 's', 'S'), bit(0o004, 'r'), bit(0o002, 'w'), x(0o001, 0o1000, 't', 'T')].join('')
}

/** A folder, or a link to one. */
export const isDirEntry = (e: RemoteEntry) => e.kind === 'dir' || !!e.toDir

/** Entries in the explorer's order: folders (and links to them) first, then by name as people sort (numbers too). */
export function sortEntries(list: readonly RemoteEntry[]): RemoteEntry[] {
  return [...list].sort((a, b) => Number(isDirEntry(b)) - Number(isDirEntry(a)) || a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true }))
}
