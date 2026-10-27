import type { DocTurn } from './docAi'
import type { TouchKind, TouchOp } from './touches'

/**
 * The graph of the AI's work in a document (as agentplay draws a session): the document in the middle, around it the
 * groups of what the turns touched (the document itself and its parts, other notes, tasks, events, pages, searches,
 * components, the work, failures), at the ends — each thing touched, with what was done to it and by which turns.
 * Laid out as a radial tree; the window draws it and opens what is clicked.
 */
export const GRAPH_GROUPS = [
  { id: 'doc', label: 'документ' },
  { id: 'notes', label: 'заметки' },
  { id: 'tasks', label: 'задачи' },
  { id: 'events', label: 'события' },
  { id: 'web', label: 'веб' },
  { id: 'search', label: 'поиск' },
  { id: 'components', label: 'компоненты' },
  { id: 'work', label: 'работа' },
  { id: 'other', label: 'прочее' },
  { id: 'errors', label: 'ошибки' },
] as const
export type GraphGroupId = (typeof GRAPH_GROUPS)[number]['id']
/** Each kind of touch — its group. */
const GROUP_OF: Record<TouchKind, GraphGroupId> = {
  doc: 'doc',
  section: 'doc',
  memory: 'doc',
  note: 'notes',
  folder: 'notes',
  file: 'notes',
  jira: 'tasks',
  event: 'events',
  web: 'web',
  search: 'search',
  component: 'components',
  work: 'work',
  chat: 'other',
  guide: 'other',
  tool: 'other',
}

export interface GraphLeaf {
  id: string
  group: GraphGroupId
  kind: TouchKind | 'error'
  /** Where it leads (a note's path, `path#part`, a link) — '' — nowhere. */
  ref: string
  label: string
  /** How many times each was done to it. */
  ops: Partial<Record<TouchOp, number>>
  failed: number
  /** The turns that touched it (their ids), the latest last. */
  turns: string[]
  last: number
}
export interface GraphGroup {
  id: GraphGroupId
  label: string
  leaves: GraphLeaf[]
}

/** The groups of what the turns touched (empty groups left out), the leaves by how much they were touched. */
export function turnGraph(turns: readonly DocTurn[]): GraphGroup[] {
  const leaves = new Map<string, GraphLeaf>()
  const put = (id: string, base: Omit<GraphLeaf, 'id' | 'ops' | 'failed' | 'turns' | 'last'>, t: DocTurn, op?: TouchOp, ok = true) => {
    const l = leaves.get(id) ?? { id, ...base, ops: {}, failed: 0, turns: [], last: 0 }
    if (op) l.ops[op] = (l.ops[op] ?? 0) + 1
    if (!ok) l.failed++
    if (!l.turns.includes(t.id)) l.turns.push(t.id)
    l.last = Math.max(l.last, t.at)
    leaves.set(id, l)
  }
  for (const t of turns) {
    for (const x of t.touches ?? []) put(`${x.kind}:${x.ref || x.label}`, { group: GROUP_OF[x.kind], kind: x.kind, ref: x.ref, label: x.label }, t, x.op, x.ok)
    if (t.outcome === 'error' && t.error) put(`error:${t.id}`, { group: 'errors', kind: 'error', ref: '', label: t.error.slice(0, 60) }, t)
  }
  const weight = (l: GraphLeaf) => Object.values(l.ops).reduce((n, k) => n + (k ?? 0), 0) + l.failed
  return GRAPH_GROUPS.flatMap((g) => {
    const ls = [...leaves.values()].filter((l) => l.group === g.id).sort((a, b) => weight(b) - weight(a) || a.label.localeCompare(b.label, 'ru'))
    return ls.length ? [{ id: g.id, label: g.label, leaves: ls }] : []
  })
}
/** What was done to a leaf most: its colour in the graph (write over run over read over search). */
export function mainOp(l: Pick<GraphLeaf, 'ops'>): TouchOp | undefined {
  return (['write', 'run', 'read', 'search'] as const).find((op) => (l.ops[op] ?? 0) > 0)
}

// ---------- the radial layout ----------
export interface Placed {
  id: string
  x: number
  y: number
  /** Its direction from the middle, radians (labels are turned along it). */
  angle: number
}
export interface GraphLayout {
  groups: Array<Placed & { group: GraphGroup }>
  leaves: Array<Placed & { leaf: GraphLeaf; from: string }>
  /** The size it takes around the middle (its radius with the labels). */
  radius: number
}
/**
 * The middle at (0, 0); each group gets a share of the circle by how many leaves it has (at least one share), its node
 * on the inner ring at the middle of its share; its leaves on the outer ring spread over the share.
 */
export function radialLayout(groups: readonly GraphGroup[], inner = 120, outer = 260): GraphLayout {
  const shares = groups.map((g) => Math.max(1, g.leaves.length))
  const total = shares.reduce((a, b) => a + b, 0) || 1
  const out: GraphLayout = { groups: [], leaves: [], radius: outer + 150 }
  let at = -Math.PI / 2
  groups.forEach((g, i) => {
    const span = (shares[i] / total) * Math.PI * 2
    const mid = at + span / 2
    out.groups.push({ id: `g:${g.id}`, x: Math.cos(mid) * inner, y: Math.sin(mid) * inner, angle: mid, group: g })
    const n = g.leaves.length
    g.leaves.forEach((l, k) => {
      const a = n === 1 ? mid : at + (span * (k + 0.5)) / n
      out.leaves.push({ id: l.id, x: Math.cos(a) * outer, y: Math.sin(a) * outer, angle: a, leaf: l, from: `g:${g.id}` })
    })
    at += span
  })
  return out
}

// ---------- what is no longer there ----------
/** Each kind of leaf whose ref names a part of a note — what the part is there: a heading, a block's name. */
const PART_OF: Partial<Record<GraphLeaf['kind'], 'heading' | 'block'>> = { section: 'heading', doc: 'heading', component: 'block' }
/** Each kind of part — whether a note's text has it. */
const HAS_PART: Record<'heading' | 'block', (text: string, part: string) => boolean> = {
  heading: (text, part) => text.split('\n').some((l) => l.replace(/^#{1,6}\s+/, '').trim() === part.trim() && /^#{1,6}\s/.test(l)),
  block: (text, part) => new RegExp(`^(\`{3,}|~{3,}).*\\bname=${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(text),
}
/**
 * A leaf that names what is no longer there: a note deleted, a section or a block gone from its note. `find` — a
 * note's path by a ref's note (none — no such note); `textOf` — a note's text when known (not read — undefined: its
 * parts are not judged). A link (a task, a page) — never judged here.
 */
export function leafGone(l: Pick<GraphLeaf, 'kind' | 'ref'>, find: (note: string) => string | undefined, textOf: (path: string) => string | undefined): boolean {
  const t = leafTarget(l)
  if (!t || 'url' in t) return false
  const path = find(t.note)
  if (!path) return true
  const part = t.part && PART_OF[l.kind]
  if (!part || !t.part) return false
  const text = textOf(path)
  return text !== undefined && !HAS_PART[part](text, t.part)
}

/** Each kind of leaf — where a click on it goes: a note (its part), a link, nowhere. */
const GOES: Record<GraphLeaf['kind'], 'note' | 'link' | 'none'> = {
  doc: 'note',
  section: 'note',
  note: 'note',
  component: 'note',
  file: 'link',
  jira: 'link',
  event: 'link',
  web: 'link',
  memory: 'none',
  folder: 'none',
  search: 'none',
  work: 'none',
  chat: 'none',
  guide: 'none',
  tool: 'none',
  error: 'none',
}
/** A leaf's place to go: a note (its part) by its path, or a link (none — nowhere to go). */
export function leafTarget(l: Pick<GraphLeaf, 'kind' | 'ref'>): { note: string; part?: string } | { url: string } | undefined {
  const goes = GOES[l.kind]
  if (!l.ref || goes === 'none') return undefined
  // (a shared note read by its link — its address, whatever the kind)
  if (goes === 'link' || /^qvarch:\/\//i.test(l.ref)) return { url: l.ref }
  const [note, ...part] = l.ref.split('#')
  return note ? { note, ...(part.length ? { part: part.join('#') } : {}) } : undefined
}
