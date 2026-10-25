import { isRunnableKind } from '../blocks/specs'
import { infoMd } from './blockInfo'
import { blockRunKey, fencedBlocksOf } from './noteBlocks'

/**
 * Each runnable block has an id of its own — its results are kept by it (a new block never shows another's results,
 * even one of the same name; one that moves keeps its own). A block without one gets one: a new block — starting
 * empty; one that was there before (an older note's) — its results go with it. A copy of another's (pasted,
 * duplicated) gets a new one, starting empty.
 */
export interface IdFix {
  /** The block's first line (counted from 1) and its info line as it becomes. */
  line0: number
  infoLine: string
  /** Its results' key now — and before (a block that was there: its results go with it; new, a copy: none). */
  key: string
  was?: string
}
/** `existed` — the block was in the note before this change (by its first line). */
export function blockIdFixes(text: string, makeId: () => string, existed: (line0: number) => boolean): IdFix[] {
  const seen = new Set<string>()
  const out: IdFix[] = []
  for (const b of fencedBlocksOf(text)) {
    if (!isRunnableKind(b.kind) || b.info.lib) continue
    if (b.info.id && !seen.has(b.info.id)) {
      seen.add(b.info.id)
      continue
    }
    let id = makeId()
    while (seen.has(id)) id = makeId()
    seen.add(id)
    const adopt = !b.info.id && existed(b.line0)
    out.push({ line0: b.line0, infoLine: `${b.fence}${infoMd({ ...b.info, id })}`, key: blockRunKey(b.info.name, b.kind, b.line0, id), ...(adopt ? { was: b.key } : {}) })
  }
  return out
}
/** A new block id: eight small letters and digits. */
export const newBlockId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => 'abcdefghijklmnopqrstuvwxyz0123456789'[n % 36]).join('')
