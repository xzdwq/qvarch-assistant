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

/**
 * A row of the tree as shown: the node, its depth; a linked note + board — one plaque (`top` / `bot`). Its lines to
 * the folders it is in: `last` — the last thing of its folder (its line ends at it: └), `rails[i]` — its folder of
 * depth i has more after it (that folder's own line, in column i − 1, goes on past this row; the top level has none).
 * A folder: `items` — what is right in it (its folders and documents; not what they hold).
 */
export interface TreeRow {
  node: VaultNode
  depth: number
  grp?: 'top' | 'bot'
  last: boolean
  rails: boolean[]
  items?: number
}

/**
 * The tree as rows: the open folders unfolded, each level sorted; a pair sorts by its note — the board waits for
 * it, then goes right under it (the two are one thing of their folder: the board's row carries the note's line on).
 */
export function treeRows(tree: VaultNode[], open: string[], sort: SortMode): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (ns: VaultNode[], depth: number, rails: boolean[]) => {
    const here = new Map(ns.map((n) => [n.path, n]))
    // the things of this folder as shown: a pair once (by its note)
    const items = ns.filter((n) => !(!n.dir && n.board && n.pair && here.has(n.pair)))
    items.forEach((n, i) => {
      const last = i === items.length - 1
      const other = !n.dir && n.pair ? here.get(n.pair) : undefined
      if (other) {
        out.push({ node: n, depth, grp: 'top', last, rails }, { node: other, depth, grp: 'bot', last, rails })
        return
      }
      out.push({ node: n, depth, last, rails, ...(n.dir ? { items: n.children?.length ?? 0 } : {}) })
      if (n.dir && open.includes(n.path)) walk(sortNodes(n.children ?? [], sort), depth + 1, [...rails, !last])
    })
  }
  walk(sortNodes(tree, sort), 0, [])
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
