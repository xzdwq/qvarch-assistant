/**
 * The notebook's graph: what a note is linked to (a tag, another note, a table its SQL reads, an endpoint its
 * requests call…) and how. Every kind of thing and every kind of edge — one table each (their words, their weight).
 */

/** What a note can be linked to. */
export const GRAPH_NODE_KINDS = ['note', 'doc', 'tag', 'heading', 'table', 'endpoint', 'host', 'jira', 'event'] as const
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number]

/** How a note is linked to it. */
export const GRAPH_EDGE_TYPES = ['links', 'tagged', 'has', 'reads', 'writes', 'defines', 'calls', 'opens', 'mentions'] as const
export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number]

/** Each kind: its word, and how much a thing of it shared by two notes says they are related. */
export const NODE_KIND: Record<GraphNodeKind, { title: string; weight: number }> = {
  note: { title: 'заметка', weight: 3 },
  doc: { title: 'общая заметка', weight: 3 },
  tag: { title: 'тег', weight: 2 },
  heading: { title: 'раздел', weight: 0.5 },
  table: { title: 'таблица', weight: 1.5 },
  endpoint: { title: 'запрос', weight: 1.5 },
  host: { title: 'сайт', weight: 0.5 },
  jira: { title: 'задача', weight: 1.5 },
  event: { title: 'событие', weight: 1 },
}
/** Each edge: its words (a note … it). */
export const EDGE_TYPE: Record<GraphEdgeType, { title: string }> = {
  links: { title: 'ссылается' },
  tagged: { title: 'с тегом' },
  has: { title: 'с разделом' },
  reads: { title: 'читает' },
  writes: { title: 'пишет в' },
  defines: { title: 'описывает' },
  calls: { title: 'вызывает' },
  opens: { title: 'открывает' },
  mentions: { title: 'упоминает' },
}

/** One edge of a note: how (`type`), to what (`kind` + its key `name`), shown as `label`, at its line (0-based). */
export interface GraphEdge {
  type: GraphEdgeType
  kind: GraphNodeKind
  name: string
  label: string
  line: number
}

/** Why two notes are related: a thing both have (`shared`), or a link from one to the other (`out` / `in`). */
export interface GraphReason {
  via: 'shared' | 'out' | 'in'
  kind: GraphNodeKind
  label: string
  /** How this note is linked to it. */
  type: GraphEdgeType
}
/** A related note with why, the strongest first. */
export interface RelatedNote {
  path: string
  score: number
  reasons: GraphReason[]
}

// ---------- the whole notebook's graph, to draw ----------
/** The things the notebook's graph shows beside the notes (headings — not: every note has some). */
export const VIEW_KINDS = ['tag', 'table', 'endpoint', 'host', 'jira', 'event'] as const satisfies readonly GraphNodeKind[]
export type ViewKind = (typeof VIEW_KINDS)[number]

/**
 * A node of the view: a note, a note not made yet (a `[[link]]` to it only — `ghost`), a folder (its notes in it), or
 * a thing notes share.
 */
export const VIEW_NODE_KINDS = ['note', 'ghost', 'folder', ...VIEW_KINDS] as const
export type ViewNodeKind = (typeof VIEW_NODE_KINDS)[number]

export interface ViewNode {
  /** `n:<path>` — a note; `g:<name>` — one not made yet; `f:<path>` — a folder; `<kind>:<name>` — a thing. */
  id: string
  kind: ViewNodeKind
  label: string
  /** A note's / a folder's path. */
  path?: string
  /** How many links it has. */
  degree: number
}
export interface ViewLink {
  from: string
  to: string
  type: GraphEdgeType
}
export interface NotebookGraph {
  nodes: ViewNode[]
  links: ViewLink[]
}

/** A reason in words: «таблица orders», «#релиз», «ссылается сюда». */
export function reasonText(r: GraphReason): string {
  if (r.via === 'in') return 'ссылается сюда'
  if (r.via === 'out') return 'ссылка отсюда'
  return r.kind === 'tag' ? `#${r.label}` : `${NODE_KIND[r.kind].title} ${r.label}`
}
