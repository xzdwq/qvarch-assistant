import { posix } from 'node:path'
import type { VaultHit, VaultNode } from '../../shared/vault'
import { filesOf, resolveWiki } from '../../shared/vault'
import { linksIn } from '../../shared/notebook/links'
import { BOARD_EXT } from '../../shared/whiteboard'

/** Reading through the vault's notes: search, event mentions. A note's text comes from `read` (it may throw). */
export type ReadNote = (path: string) => string

const tryRead = (read: ReadNote, path: string): string | undefined => {
  try {
    return read(path)
  } catch {
    return undefined
  }
}

/** Every event mentioned in the notes (qvarch://event/<day>/<id>): its id → the notes (paths). */
export function eventMentions(tree: VaultNode[], read: ReadNote): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const walk = (ns: VaultNode[]) => {
    for (const n of ns) {
      if (n.dir) {
        walk(n.children ?? [])
        continue
      }
      if (n.board) continue
      const text = tryRead(read, n.path)
      if (text === undefined || !text.includes('qvarch://event/')) continue
      for (const m of text.matchAll(/qvarch:\/\/event\/\d{4}-\d{2}-\d{2}\/([\w-]+)/g)) {
        const list = (out[m[1]] ??= [])
        if (!list.includes(n.path)) list.push(n.path)
      }
    }
  }
  walk(tree)
  return out
}

/** The notes whose `[[links]]` lead to a note (it itself — not counted), by path. */
export function backlinks(tree: VaultNode[], read: ReadNote, target: string): string[] {
  const files = filesOf(tree)
  const out: string[] = []
  for (const path of files) {
    if (path === target || path.endsWith(BOARD_EXT)) continue
    const text = tryRead(read, path)
    if (text === undefined || !text.includes('[[')) continue
    if (linksIn(text).some((l) => l.kind === 'note' && resolveWiki(l.target, files) === target)) out.push(path)
  }
  return out
}

/** A note's lines with the needle (5 at most, one per line): a window around the match; and how many matches. */
function matchLines(text: string, needle: string): { count: number; lines: VaultHit['lines'] } {
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
  return { count, lines }
}

/** All notes whose name or text has the query (any case); a few matching lines of each. The name first, then how often. */
export function searchNotes(tree: VaultNode[], read: ReadNote, q: string, limit = 60): VaultHit[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  const out: VaultHit[] = []
  for (const path of filesOf(tree)) {
    // a board: found by its name only (its file is drawing data, not text)
    if (path.toLowerCase().endsWith(BOARD_EXT)) {
      const bn = posix.basename(path, BOARD_EXT)
      if (bn.toLowerCase().includes(needle)) out.push({ path, name: bn, inName: true, count: 0, lines: [] })
      continue
    }
    const text = tryRead(read, path)
    if (text === undefined) continue
    const name = posix.basename(path, '.md')
    const { count, lines } = matchLines(text, needle)
    const inName = name.toLowerCase().includes(needle)
    if (count || inName) out.push({ path, name, inName, count, lines })
    if (out.length >= limit) break
  }
  return out.sort((a, b) => Number(b.inName) - Number(a.inName) || b.count - a.count)
}
