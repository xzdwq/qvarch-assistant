import { NODE_KIND, type GraphEdgeType, type GraphNodeKind, type GraphReason, type RelatedNote } from '../../../shared/notebook/graph'

/** A thing another note has too: that note, how it has it, how many notes have it (`df`). */
export interface SharedRow {
  path: string
  type: GraphEdgeType
  kind: GraphNodeKind
  label: string
  df: number
}
/** A link between this note and another: which, how it links. */
export interface LinkRow {
  path: string
  label: string
}

/** A direct link weighs as much as the strongest thing two notes can share. */
const LINK_WEIGHT = 3
export const RELATED_MAX = 40

/**
 * The notes related to one, the strongest first: linked to it or from it, or having what it has. What many notes
 * have says little — a thing's weight is divided by how many notes have it (a heading «Итоги» in every note does
 * not tie them all together).
 */
export function relatedNotes(shared: readonly SharedRow[], out: readonly LinkRow[], into: readonly LinkRow[], max = RELATED_MAX): RelatedNote[] {
  const by = new Map<string, RelatedNote>()
  const of = (path: string) => by.get(path) ?? by.set(path, { path, score: 0, reasons: [] }).get(path)!
  const reason = (r: RelatedNote, x: GraphReason, w: number) => {
    r.score += w
    if (!r.reasons.some((y) => y.via === x.via && y.kind === x.kind && y.label.toLowerCase() === x.label.toLowerCase())) r.reasons.push(x)
  }
  for (const l of into) reason(of(l.path), { via: 'in', kind: 'note', label: l.label, type: 'links' }, LINK_WEIGHT)
  for (const l of out) reason(of(l.path), { via: 'out', kind: 'note', label: l.label, type: 'links' }, LINK_WEIGHT)
  for (const s of shared) reason(of(s.path), { via: 'shared', kind: s.kind, label: s.label, type: s.type }, NODE_KIND[s.kind].weight / Math.log2(1 + Math.max(1, s.df)))
  return [...by.values()]
    .map((r) => ({ ...r, score: Math.round(r.score * 100) / 100, reasons: r.reasons.sort((a, b) => weightOf(b) - weightOf(a)) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, max)
}
const weightOf = (r: GraphReason) => (r.via === 'shared' ? NODE_KIND[r.kind].weight : LINK_WEIGHT)
