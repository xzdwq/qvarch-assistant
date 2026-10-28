import type { GraphEdge, GraphEdgeType } from '../../../shared/notebook/graph'
import { linksIn, parseDocLink, placeKey, type NoteLinkRef } from '../../../shared/notebook/links'
import { parseNoteLink } from '../../../shared/noteEvents'
import { CODE_LANGS } from '../blockInfo'
import { FENCE_OPEN, findFenceClose } from '../fence'
import { endpointOf, httpEndpoints, urlsIn, type Endpoint } from './endpoints'
import { sqlTables } from './sqlTables'
import { tagsIn } from './tags'

/**
 * A note's edges, read from its text alone (exact — no guessing): its links, tags and headings from the prose; what
 * its components work with from each fenced block, by the block's language (a registry). A link to a note is kept
 * as written (`[[Имя]]`) — which note it is, is resolved when asked (a note made later is found then).
 */

/** At most this many edges a note (a generated note of thousands of requests — its first ones). */
export const EDGES_MAX = 2000

/** The kinds of fenced text that say what they work with, and which languages are each. */
const FENCE_FAMILIES = ['sql', 'http', 'code', 'browser'] as const
type FenceFamily = (typeof FENCE_FAMILIES)[number]
const FAMILY_OF: Record<string, FenceFamily> = {
  sql: 'sql',
  http: 'http',
  rest: 'http',
  browser: 'browser',
  ...Object.fromEntries(CODE_LANGS.map((l) => [l, 'code'])),
}

/** An address's edges: its endpoint (a path there is) and its site. */
function endpointEdges(e: Endpoint & { line: number }, type: GraphEdgeType, line0: number): GraphEdge[] {
  const line = line0 + e.line
  const out: GraphEdge[] = []
  if (e.path) out.push({ type, kind: 'endpoint', name: e.path, label: e.method ? `${e.method} ${e.path}` : e.path, line })
  if (e.host) out.push({ type, kind: 'host', name: e.host, label: e.host, line })
  return out
}
/** What each kind of fenced text works with (`line0` — the body's first line in the note). */
const FENCE_EDGES: Record<FenceFamily, (body: string, line0: number) => GraphEdge[]> = {
  sql: (body, line0) => sqlTables(body).map((t) => ({ type: t.use, kind: 'table', name: t.name, label: t.label, line: line0 + t.line })),
  http: (body, line0) => httpEndpoints(body).flatMap((e) => endpointEdges(e, 'calls', line0)),
  code: (body, line0) => urlsIn(body).flatMap((e) => endpointEdges(e, 'opens', line0)),
  browser: (body, line0) => urlsIn(body).flatMap((e) => endpointEdges(e, 'opens', line0)),
}

/** A link's edge (a file shown — none). */
const LINK_EDGES: Record<NoteLinkRef['kind'], (l: NoteLinkRef, line: number) => GraphEdge | undefined> = {
  note: (l, line) => ({ type: 'links', kind: 'note', name: l.target.replace(/\.md$/i, '').toLowerCase(), label: l.target, line }),
  doc: (l, line) => {
    const d = parseDocLink(l.target)
    return d && { type: 'links', kind: 'doc', name: d.doc, label: ('label' in l && l.label) || d.doc, line }
  },
  jira: (l, line) => {
    const j = parseNoteLink(l.target)
    return j?.kind === 'jira' ? { type: 'mentions', kind: 'jira', name: j.key, label: j.key, line } : undefined
  },
  event: (l, line) => {
    const e = parseNoteLink(l.target)
    return e?.kind === 'event' ? { type: 'mentions', kind: 'event', name: e.id, label: ('label' in l && l.label) || e.id, line } : undefined
  },
  web: (l, line) => {
    const host = endpointOf(l.target)?.host
    return host ? { type: 'mentions', kind: 'host', name: host, label: host, line } : undefined
  },
  file: () => undefined,
}

/** The note's text taken apart: its prose (fences blanked, lines kept) and its fenced blocks. */
function partsOf(text: string): { prose: string; fences: Array<{ lang: string; body: string; line0: number }> } {
  const lines = text.split('\n')
  const fences: Array<{ lang: string; body: string; line0: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_OPEN.exec(lines[i])
    if (!m) continue
    const close = findFenceClose(lines, i + 1, m[1])
    fences.push({ lang: m[2].toLowerCase(), body: lines.slice(i + 1, close).join('\n'), line0: i + 1 })
    for (let j = i; j <= Math.min(close, lines.length - 1); j++) lines[j] = ''
    i = close
  }
  return { prose: lines.join('\n'), fences }
}

/** A note's edges, each (how, to what) once — at its first place. */
export function docGraph(text: string): GraphEdge[] {
  const out: GraphEdge[] = []
  const seen = new Set<string>()
  const add = (e: GraphEdge | undefined) => {
    if (!e || !e.name || out.length >= EDGES_MAX) return
    const key = `${e.type}|${e.kind}|${e.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(e)
  }
  const { prose, fences } = partsOf(text)
  const lineOf = (needle: string) => Math.max(0, prose.slice(0, Math.max(0, prose.indexOf(needle))).split('\n').length - 1)
  for (const t of tagsIn(prose)) add({ type: 'tagged', kind: 'tag', name: t.name, label: t.label, line: t.line })
  prose.split('\n').forEach((l, line) => {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l)
    const key = h && placeKey(h[1])
    if (key) add({ type: 'has', kind: 'heading', name: key.toLowerCase(), label: key, line })
  })
  for (const l of linksIn(prose)) add(LINK_EDGES[l.kind](l, lineOf(l.raw)))
  for (const f of fences) {
    const family = Object.hasOwn(FAMILY_OF, f.lang) ? FAMILY_OF[f.lang] : undefined
    if (family) for (const e of FENCE_EDGES[family](f.body, f.line0)) add(e)
  }
  return out
}
