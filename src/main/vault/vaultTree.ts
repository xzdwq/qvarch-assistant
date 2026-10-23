import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { VaultNode } from '../../shared/vault'
import { BOARD_EXT } from '../../shared/whiteboard'
import type { VaultFiles } from './vaultFiles'
import type { VaultMeta } from './vaultMeta'

/** The kinds of files the tree lists: a note (.md) and a board (.qboard); anything else is not shown. */
const LISTED: Record<string, { board?: true }> = { '.md': {}, [BOARD_EXT]: { board: true } }

/** The vault as a tree: folders first, then by name (numbers in natural order); dot folders are not listed. */
export function readVaultTree(files: VaultFiles, meta: VaultMeta): VaultNode[] {
  const walk = (dir: string): VaultNode[] => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }
    const out: VaultNode[] = []
    for (const name of names) {
      if (name.startsWith('.')) continue
      const file = join(dir, name)
      let st
      try {
        st = statSync(file)
      } catch {
        continue
      }
      const rel = files.rel(file)
      const base = { path: rel, mtime: st.mtimeMs, ctime: st.birthtimeMs || st.ctimeMs, color: meta.colorOf(rel), emoji: meta.emojiOf(rel) }
      if (st.isDirectory()) {
        out.push({ ...base, name, dir: true, children: walk(file) })
        continue
      }
      const ext = extname(name).toLowerCase()
      const kind = LISTED[ext]
      if (kind) out.push({ ...base, name: name.slice(0, -ext.length), dir: false, ...kind, pair: meta.pairOf(rel) })
    }
    return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'ru', { numeric: true })))
  }
  return walk(files.root)
}
