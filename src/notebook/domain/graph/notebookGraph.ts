import { VIEW_KINDS, type GraphEdgeType, type GraphNodeKind, type NotebookGraph, type ViewKind, type ViewLink, type ViewNode } from '../../../shared/notebook/graph'

/**
 * The whole notebook as a graph to draw (as Obsidian's): its notes; the notes its `[[links]]` name but nobody made yet;
 * its folders, each holding its notes; the things notes share (a tag — even one note's: a tag is put on purpose; a
 * table, a request… — two notes' and more: one note's says nothing of how notes are related). Headings — not (every
 * note has some). A link goes from the note that has it. A link to a note resolves among the notes there are now.
 */

/** An edge of some note as the index keeps it. */
export interface EdgeRow {
  path: string
  type: GraphEdgeType
  kind: GraphNodeKind
  name: string
  label: string
}
/** How many notes must share a thing of a kind for it to be drawn. */
const SHARED_BY: Record<ViewKind, number> = { tag: 1, table: 2, endpoint: 2, host: 2, jira: 2, event: 2 }

const isViewKind = (k: GraphNodeKind): k is ViewKind => (VIEW_KINDS as readonly string[]).includes(k)
const nameOf = (path: string) => path.replace(/^.*\//, '').replace(/\.md$/i, '')

/**
 * The graph (`files` — the notes there are; `resolve` — a link's row → the note's path, none — not made yet).
 */
export function notebookGraph(files: readonly string[], rows: readonly EdgeRow[], resolve: (row: EdgeRow) => string | undefined): NotebookGraph {
  const notes = new Set(files)
  const nodes = new Map<string, ViewNode>()
  const links: ViewLink[] = []
  const seen = new Set<string>()
  const node = (id: string, make: () => Omit<ViewNode, 'id' | 'degree'>) => nodes.get(id) ?? nodes.set(id, { id, degree: 0, ...make() }).get(id)!
  const note = (path: string) => node(`n:${path}`, () => ({ kind: 'note', label: nameOf(path), path }))
  const link = (from: ViewNode, to: ViewNode, type: ViewLink['type']) => {
    const key = [from.id, to.id].sort().join('|')
    if (from.id === to.id || seen.has(key)) return
    seen.add(key)
    links.push({ from: from.id, to: to.id, type })
    from.degree++
    to.degree++
  }
  for (const p of files) note(p)
  // the folders, each holding its notes and its folders
  const folder = (dir: string): ViewNode => node(`f:${dir}`, () => ({ kind: 'folder', label: nameOf(dir), path: dir }))
  for (const p of files) {
    const parts = p.split('/')
    for (let k = parts.length - 1; k >= 1; k--) {
      const dir = parts.slice(0, k).join('/')
      const child = k === parts.length - 1 ? note(p) : folder(parts.slice(0, k + 1).join('/'))
      link(folder(dir), child, 'has')
    }
  }
  // links to notes (made or not yet); the things, by who has them
  const holders = new Map<string, { kind: ViewKind; label: string; rows: EdgeRow[] }>()
  for (const r of rows) {
    if (!notes.has(r.path)) continue
    if (r.kind === 'note' || r.kind === 'doc') {
      const to = resolve(r)
      if (to && notes.has(to)) link(note(r.path), note(to), 'links')
      else if (r.kind === 'note') link(note(r.path), node(`g:${r.name}`, () => ({ kind: 'ghost', label: r.label })), 'links')
      continue
    }
    if (!isViewKind(r.kind)) continue
    const key = `${r.kind}:${r.name}`
    const h = holders.get(key) ?? holders.set(key, { kind: r.kind, label: r.label, rows: [] }).get(key)!
    h.rows.push(r)
  }
  for (const [id, h] of holders) {
    if (new Set(h.rows.map((r) => r.path)).size < SHARED_BY[h.kind]) continue
    const thing = node(id, () => ({ kind: h.kind, label: h.label }))
    for (const r of h.rows) link(note(r.path), thing, r.type)
  }
  return { nodes: [...nodes.values()], links }
}

/** Only what is within `depth` links of a node (the view around the note open), the node itself included. */
export function around(g: NotebookGraph, id: string, depth: number): NotebookGraph {
  const near = new Map<string, string[]>()
  for (const l of g.links) {
    near.set(l.from, [...(near.get(l.from) ?? []), l.to])
    near.set(l.to, [...(near.get(l.to) ?? []), l.from])
  }
  const keep = new Set([id])
  let edge = [id]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const x of edge) for (const y of near.get(x) ?? []) if (!keep.has(y)) (keep.add(y), next.push(y))
    edge = next
  }
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), links: g.links.filter((l) => keep.has(l.from) && keep.has(l.to)) }
}

/**
 * The graph as shown: the nodes of the kinds switched off left out with their links; each node's degree — of what is
 * shown (a note is not bigger for its folder while folders are hidden).
 */
export function visibleGraph(g: NotebookGraph, on: (kind: ViewNode['kind']) => boolean): NotebookGraph {
  const keep = new Set(g.nodes.filter((n) => on(n.kind)).map((n) => n.id))
  const links = g.links.filter((l) => keep.has(l.from) && keep.has(l.to))
  const degree = new Map<string, number>()
  for (const l of links) for (const id of [l.from, l.to]) degree.set(id, (degree.get(id) ?? 0) + 1)
  return { nodes: g.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })), links }
}
