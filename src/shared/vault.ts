/** The notebook (Markdown files): a node of the tree, a search hit, and the helpers both sides use. */

/** What can be made in the vault's tree. */
export const VAULT_ENTRY_KINDS = ['note', 'folder', 'board'] as const
export type VaultEntryKind = (typeof VAULT_ENTRY_KINDS)[number]
/** A kind from outside (IPC): a known one as is, anything else — a note. */
export const toVaultEntryKind = (v: unknown): VaultEntryKind => VAULT_ENTRY_KINDS.find((k) => k === v) ?? 'note'

export interface VaultNode {
  /** Relative to the vault, "/" separated, with ".md" for notes. */
  path: string
  /** Shown name (a note — without ".md"). */
  name: string
  dir: boolean
  mtime: number
  /** When the file was created (ms). */
  ctime: number
  /** A colour mark set by the user (the icon in the tree takes it). */
  color?: string
  /** An emoji mark (shown instead of the icon; with the colour, on its tint). */
  emoji?: string
  /** A board (.qboard), not a note. */
  board?: boolean
  /** Linked with (a note ↔ a board): the other one's path. */
  pair?: string
  /** A shared document (a note's or a board's mark): its id. */
  doc?: string
  /** A shared folder (its `.qa-space`): its space's id. */
  space?: string
  /** A note's runnable components as chips (db, js/ts, http…), each once. */
  runs?: string[]
  children?: VaultNode[]
}

/** The recordings a text embeds. */
export function audiosOf(text: string): string[] {
  const out: string[] = []
  for (const l of text.split('\n')) {
    const m = l.match(AUDIO_EMBED)
    if (m) out.push(m[1])
  }
  return out
}

export interface VaultHit {
  path: string
  name: string
  inName: boolean
  /** How many times the text has it. */
  count: number
  /** A few lines with it: the line number, the match in the line, and a snippet with the match at `at`. */
  lines: Array<{ line: number; col: number; len: number; text: string; at: number }>
}

/** A picture of a note / a board: vault/.images/<file> (its own line `![[.images/<file>]]` in a note). */
export const IMAGE_REL = /^\.images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)$/i
export const IMAGE_EMBED = /^!\[\[(\.images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp))\]\]\s*$/i
export const imageEmbed = (rel: string) => `![[${rel}]]`
/** The pictures a note or a board has (anywhere in its text — a board keeps them in its JSON). */
export function imagesOf(text: string): string[] {
  return [...new Set(text.match(/\.images\/[\w.-]+\.(?:png|jpe?g|gif|webp|bmp)/gi) ?? [])]
}

/** A voice recording in a note: a line `![[.audio/<file>.webm]]` (Obsidian's embed syntax). */
export const AUDIO_EMBED = /^!\[\[(\.audio\/[\w.-]+\.webm)\]\]\s*$/
export const audioEmbed = (rel: string) => `![[${rel}]]`

/** The note a wiki link `[[Name]]` / `[[folder/Name|text]]` points to: by path, else by name anywhere. */
export function resolveWiki(target: string, files: string[]): string | undefined {
  const t = target.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '').toLowerCase()
  if (!t) return undefined
  const exact = files.find((f) => f.toLowerCase() === `${t}.md`)
  if (exact) return exact
  return files.find((f) => (f.split('/').pop() ?? '').toLowerCase() === `${t}.md`)
}

/** Markdown with the audio lines cut out (they are shown as players): text and audio parts in order. */
export function splitAudio(text: string): Array<{ md: string } | { audio: string; line: number }> {
  const out: Array<{ md: string } | { audio: string; line: number }> = []
  let buf: string[] = []
  text.split('\n').forEach((l, i) => {
    const m = l.match(AUDIO_EMBED)
    if (!m) return void buf.push(l)
    if (buf.length) out.push({ md: buf.join('\n') })
    buf = []
    out.push({ audio: m[1], line: i })
  })
  if (buf.length) out.push({ md: buf.join('\n') })
  return out
}

/** All note paths of a tree. */
export function filesOf(nodes: VaultNode[]): string[] {
  const out: string[] = []
  const walk = (ns: VaultNode[]) => ns.forEach((n) => (n.dir ? walk(n.children ?? []) : out.push(n.path)))
  walk(nodes)
  return out
}

/** A path renamed / moved: everything that pointed into it follows. */
export function remapPath(p: string, from: string, to: string): string {
  if (p === from) return to
  return p.startsWith(from + '/') ? to + p.slice(from.length) : p
}
