import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { chatRoomsIn } from '../../notebook/blocks/chat/model'
import { runChipsOf } from '../../notebook/domain/noteBlocks'
import { headTags } from '../../notebook/domain/graph/tags'
import { formatOf } from '../../shared/transport/sharedFormats'
import { SPACE_LINK_FILE } from '../../shared/transport/space'
import { BOARD_EXT } from '../../shared/whiteboard'

/** What the tree shows of a file beyond its name: the shared document it is, its runnable components. */
export interface FileFacts {
  doc?: string
  runs?: string[]
  /** The chats it shows (their rooms). */
  chats?: string[]
  /** The tags of its first line. */
  tags?: string[]
}
/** A board's mark is at its very start: only its head is read (a board may be big). */
const HEAD_BYTES = 200

function readHead(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    return buf.toString('utf8', 0, readSync(fd, buf, 0, HEAD_BYTES, 0))
  } finally {
    closeSync(fd)
  }
}
/** Each listed kind of file: how its facts are read. */
const READERS: Record<string, (file: string, rel: string) => FileFacts> = {
  '.md': (file, rel) => {
    const text = readFileSync(file, 'utf8')
    const runs = runChipsOf(text)
    const chats = chatRoomsIn(text)
    const tags = headTags(text)
    return { doc: formatOf(rel)?.docOf(text) || undefined, ...(runs.length ? { runs } : {}), ...(chats.length ? { chats } : {}), ...(tags.length ? { tags } : {}) }
  },
  [BOARD_EXT]: (file, rel) => ({ doc: formatOf(rel)?.docOf(readHead(file)) || undefined }),
}

/**
 * The tree's facts of the notebook's files, kept by their time and size: a file read again only when it changed
 * (the tree is read on every change of the notebook).
 */
export class VaultFacts {
  private cache = new Map<string, { stamp: string; facts: FileFacts }>()

  /** A file's facts (`ext` — its kind, lower case); a file that can't be read — none. */
  of(file: string, rel: string, ext: string, st: { mtimeMs: number; size: number }): FileFacts {
    const stamp = `${st.mtimeMs}|${st.size}`
    const hit = this.cache.get(rel)
    if (hit?.stamp === stamp) return hit.facts
    const read = Object.hasOwn(READERS, ext) ? READERS[ext] : undefined
    let facts: FileFacts = {}
    try {
      facts = read ? read(file, rel) : {}
    } catch {
      // gone or locked a moment — read again next time
      return {}
    }
    this.cache.set(rel, { stamp, facts })
    return facts
  }

  /** A folder's shared space (its `.qa-space`), if it is one. */
  spaceOf(dir: string, names: readonly string[]): string | undefined {
    if (!names.includes(SPACE_LINK_FILE)) return undefined
    try {
      const space = (JSON.parse(readFileSync(join(dir, SPACE_LINK_FILE), 'utf8')) as { space?: unknown }).space
      return typeof space === 'string' && space ? space : undefined
    } catch {
      return undefined
    }
  }

  /** Files no longer in the tree forgotten. */
  keepOnly(rels: ReadonlySet<string>): void {
    for (const rel of this.cache.keys()) if (!rels.has(rel)) this.cache.delete(rel)
  }
}
