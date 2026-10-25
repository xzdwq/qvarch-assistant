import type { BlockInfo } from './blockInfo'
import type { BlockKind, NoteBlock } from './blockSpec'
import { splitFence } from './fence'
import { findBlocks } from './findBlocks'

/**
 * A note's blocks with what their fence says (info line, body) and the key their runs are kept under — the one way
 * every part of the app lists the note's blocks (runs, reports, the AI tools, regression, recording).
 */

/**
 * The key a block's run is kept under: its own id (it keeps its results wherever it moves; a new block of the same
 * name never shows another's); one without an id yet (an older note's) — its name, or its kind and first line. Its
 * name is what it publishes its value under ({{name}}), not where its results are kept.
 */
export const blockRunKey = (name: string | undefined, kind: BlockKind | string, line: number, id?: string) => (id ? `_${id}` : name || `_${kind}${line}`)

export interface FencedNoteBlock extends NoteBlock {
  fence: string
  info: BlockInfo
  body: string
  /** Its run's key (blockRunKey). */
  key: string
}

/** The note's fenced blocks (a loop's start, a table, a picture… are not fenced: left out). */
export function fencedBlocksOf(text: string): FencedNoteBlock[] {
  return findBlocks(text.split('\n'))
    .filter((b) => /^(`{3,}|~{3,})/.test(b.src))
    .map((b) => {
      const { fence, info, body } = splitFence(b.src)
      return { ...b, fence, info, body, key: blockRunKey(info.name, b.kind, b.line0, info.id) }
    })
}
