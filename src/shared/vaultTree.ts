import type { VaultNode } from './vault'

/** The vault's tree as both sides read it: a node by its path, the orders it is sorted in, the rows it is shown as. */

/** The node at `path` (anywhere in the tree). */
export function findNode(tree: VaultNode[], path: string): VaultNode | undefined {
  for (const n of tree) {
    if (n.path === path) return n
    const c = n.dir ? findNode(n.children ?? [], path) : undefined
    if (c) return c
  }
  return undefined
}

export type SortMode = 'name' | 'name-desc' | 'mtime' | 'mtime-old' | 'ctime' | 'ctime-old'
export const SORTS: Array<{ id: SortMode; label: string }> = [
  { id: 'name', label: 'По имени (А → Я)' },
  { id: 'name-desc', label: 'По имени (Я → А)' },
  { id: 'mtime', label: 'Изменённые — новые сверху' },
  { id: 'mtime-old', label: 'Изменённые — старые сверху' },
  { id: 'ctime', label: 'Созданные — новые сверху' },
  { id: 'ctime-old', label: 'Созданные — старые сверху' },
]
const BY: Record<SortMode, (a: VaultNode, b: VaultNode) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }),
  'name-desc': (a, b) => b.name.localeCompare(a.name, 'ru', { numeric: true }),
  mtime: (a, b) => b.mtime - a.mtime,
  'mtime-old': (a, b) => a.mtime - b.mtime,
  ctime: (a, b) => b.ctime - a.ctime,
  'ctime-old': (a, b) => a.ctime - b.ctime,
}
/** Folders first, then by the chosen order. */
export function sortNodes(ns: VaultNode[], mode: SortMode): VaultNode[] {
  return [...ns].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : BY[mode](a, b)))
}

/** A row of the tree as shown: the node, its depth; a linked note + board — one plaque (`top` / `bot`). */
export interface TreeRow {
  node: VaultNode
  depth: number
  grp?: 'top' | 'bot'
}
/**
 * The tree as rows: the open folders unfolded, each level sorted; a pair sorts by its note — the board waits for
 * it, then goes right under it.
 */
export function treeRows(tree: VaultNode[], open: string[], sort: SortMode): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (ns: VaultNode[], depth: number) => {
    const here = new Map(ns.map((n) => [n.path, n]))
    for (const n of ns) {
      const other = !n.dir && n.pair ? here.get(n.pair) : undefined
      if (other) {
        if (n.board) continue
        out.push({ node: n, depth, grp: 'top' }, { node: other, depth, grp: 'bot' })
        continue
      }
      out.push({ node: n, depth })
      if (n.dir && open.includes(n.path)) walk(sortNodes(n.children ?? [], sort), depth + 1)
    }
  }
  walk(sortNodes(tree, sort), 0)
  return out
}

/**
 * The tree with only these notes (a tag's): a note's linked board stays with it, a folder stays when something under
 * it does; and its folders (shown unfolded — the found notes are seen at once).
 */
export function keepNotes(tree: VaultNode[], keep: ReadonlySet<string>): { tree: VaultNode[]; dirs: string[] } {
  const dirs: string[] = []
  const walk = (ns: VaultNode[]): VaultNode[] => {
    const out: VaultNode[] = []
    for (const n of ns) {
      if (n.dir) {
        const children = walk(n.children ?? [])
        if (children.length) (dirs.push(n.path), out.push({ ...n, children }))
      } else if (keep.has(n.path) || (n.pair && keep.has(n.pair))) out.push(n)
    }
    return out
  }
  return { tree: walk(tree), dirs }
}
