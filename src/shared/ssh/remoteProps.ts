import type { RemoteKind } from './remoteFiles'

/**
 * An entry's properties as the explorer's «Свойства» shows them: what SFTP tells (size, rights, ids, times) and, where
 * the server has a POSIX shell, what `stat` / `file` add (owner and group names, creation time, inode, links, the
 * contents' type). A folder's whole size is counted only when asked (it may take long).
 */
export interface RemoteProps {
  path: string
  name: string
  kind: RemoteKind
  size: number
  /** Permission bits as `rwxr-xr-x` and in octal (`0755`). */
  rights: string
  octal: string
  uid: number
  gid: number
  owner?: string
  group?: string
  /** Times, ms (0 — unknown). */
  mtime: number
  atime: number
  /** Metadata changed (rights, owner…). */
  ctime?: number
  /** Created (the file system may not know it). */
  birth?: number
  inode?: string
  links?: number
  /** What `stat` calls it: «regular file», «directory», «symbolic link»… */
  typeText?: string
  /** What `file` makes of its contents. */
  contents?: string
  /** A link: where it leads, and what is there. */
  target?: string
  targetKind?: RemoteKind
  /** The folder it is in: its owner and group (offered when changing them — «как у папки»). */
  parentOwner?: string
  parentGroup?: string
  /** The signed-in user and their main group (offered too). */
  me?: string
  myGroup?: string
}

/** A folder's contents counted. */
export interface DirSummary {
  bytes: number
  files: number
  dirs: number
}

/** The permission bits (and setuid / setgid / sticky) in octal: `0755`, `4755`. */
export const octalOf = (mode: number) => (mode & 0o7777).toString(8).padStart(4, '0')

/** The `stat -c` format the props command asks for (fields by `|`): owner, group, birth, ctime, inode, links, type. */
export const STAT_FORMAT = '%U|%G|%W|%Z|%i|%h|%F'
/** Splits the props command's output: stat's line, then file's. */
export const PROPS_SPLIT = '--qvarch-props--'

/** Splits off the last part: the folder's owner and group, the signed-in user and their group. */
export const PROPS_WHO_SPLIT = '--qvarch-who--'

/**
 * The props command for a path (quoted already): `stat`, then `file` where there is one, then the folder's owner and
 * group and `id`; errors left out.
 */
export const propsCommand = (quoted: string) =>
  `LC_ALL=C stat -c '${STAT_FORMAT}' -- ${quoted} 2>/dev/null; echo '${PROPS_SPLIT}'; command -v file >/dev/null 2>&1 && LC_ALL=C file -b -- ${quoted} 2>/dev/null; ` +
  `echo '${PROPS_WHO_SPLIT}'; LC_ALL=C stat -c '%U|%G' -- "$(dirname -- ${quoted})" 2>/dev/null || echo '|'; id -un 2>/dev/null || echo; id -gn 2>/dev/null || echo`

/** The last part's lines → the folder's owner and group, the user and their group. */
function parseWho(part: string): Partial<RemoteProps> {
  const [folder = '', me = '', myGroup = ''] = part.replace(/^\r?\n/, '').split(/\r?\n/).slice(0, 3).map((l) => l.trim())
  const [parentOwner, parentGroup] = folder.split('|')
  const r: Partial<RemoteProps> = {}
  const keep = (k: 'parentOwner' | 'parentGroup' | 'me' | 'myGroup', v?: string) => v && v !== 'UNKNOWN' && (r[k] = v)
  keep('parentOwner', parentOwner)
  keep('parentGroup', parentGroup)
  keep('me', me)
  keep('myGroup', myGroup)
  return r
}

/** Seconds as `stat` writes them → ms (0, `-`, `?` — unknown). */
const secs = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n * 1000 : undefined
}

/** What the props command printed → the fields it adds (none it could not tell). */
export function parsePropsOutput(out: string): Partial<RemoteProps> {
  const [head, whoPart] = out.split(PROPS_WHO_SPLIT)
  const [statPart = '', filePart = ''] = head.split(PROPS_SPLIT)
  const r: Partial<RemoteProps> = whoPart === undefined ? {} : parseWho(whoPart)
  const line = statPart.trim().split(/\r?\n/).pop() ?? ''
  const f = line.split('|')
  if (f.length >= 7) {
    const [owner, group, birth, ctime, inode, links, ...type] = f
    if (owner && owner !== 'UNKNOWN') r.owner = owner
    if (group && group !== 'UNKNOWN') r.group = group
    r.birth = secs(birth)
    r.ctime = secs(ctime)
    if (/^\d+$/.test(inode)) r.inode = inode
    if (/^\d+$/.test(links)) r.links = Number(links)
    if (type.join('|').trim()) r.typeText = type.join('|').trim()
  }
  const contents = filePart.trim()
  // (`file` on a folder says just «directory» — nothing new)
  if (contents && contents !== r.typeText) r.contents = contents
  return r
}

/** The folder-count command for a path (quoted): apparent bytes (GNU `du -sb`, else blocks × 1024), files, folders. */
export const dirSummaryCommand = (q: string) =>
  `b=$(du -sb -- ${q} 2>/dev/null | cut -f1); [ -n "$b" ] || b=$(( $(du -sk -- ${q} 2>/dev/null | cut -f1) * 1024 )); echo "$b"; find ${q} -type f 2>/dev/null | wc -l; find ${q} -mindepth 1 -type d 2>/dev/null | wc -l`

/** What the folder-count command printed → the summary (undefined — it could not count). */
export function parseDirSummary(out: string): DirSummary | undefined {
  const [bytes, files, dirs] = out
    .trim()
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
  if (![bytes, files, dirs].every((n) => Number.isFinite(n) && n >= 0)) return undefined
  return { bytes, files, dirs }
}
