import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { VaultNode } from '../../shared/vault'
import { BOARD_EXT } from '../../shared/whiteboard'
import type { VaultFacts } from './vaultFacts'
import type { VaultFiles } from './vaultFiles'
import type { VaultMeta } from './vaultMeta'

/** The kinds of files the tree lists: a note (.md) and a board (.qboard); anything else is not shown. */
const LISTED: Record<string, { board?: true }> = { '.md': {}, [BOARD_EXT]: { board: true } }

/**
 * The vault as a tree: folders first, then by name (numbers in natural order); dot folders are not listed. Each file
 * with its facts (the shared document it is, its runnable components), a shared folder with its space.
 */
export function readVaultTree(files: VaultFiles, meta: VaultMeta, facts: VaultFacts): VaultNode[] {
  const seen = new Set<string>()
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
        const children = walk(file)
        let inner: string[] = []
        try {
          inner = readdirSync(file)
        } catch {
          // (listed above already — gone a moment ago)
        }
        const space = facts.spaceOf(file, inner)
        out.push({ ...base, name, dir: true, ...(space ? { space } : {}), children })
        continue
      }
      const ext = extname(name).toLowerCase()
      const kind = LISTED[ext]
      if (!kind) continue
      seen.add(rel)
      const f = facts.of(file, rel, ext, st)
      out.push({ ...base, name: name.slice(0, -ext.length), dir: false, ...kind, pair: meta.pairOf(rel), ...(f.doc ? { doc: f.doc } : {}), ...(f.runs ? { runs: f.runs } : {}) })
    }
    return out.sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name, 'ru', { numeric: true })))
  }
  const tree = walk(files.root)
  facts.keepOnly(seen)
  return tree
}
