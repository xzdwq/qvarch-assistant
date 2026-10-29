/**
 * Tabs that are views, not files (the notebook's graph, a database's ER diagram): opened, moved, kept and closed as a
 * note's tab is, but never read from the disk, saved, recorded into. Each kind of view — its paths (`qa:…`, which no
 * file of the vault can have), its icon, its title.
 */
export const VIEW_KINDS = ['graph', 'er'] as const
export type ViewKind = (typeof VIEW_KINDS)[number]

export const GRAPH_TAB = 'qa:graph'
const ER_PREFIX = 'qa:er:'
/** An ER diagram's tab: its connection's name (the title says it), its own id. */
export const erTabPath = (db: string, id: string) => `${ER_PREFIX}${db}:${id}`
export const erTabOf = (path: string) => {
  const [db, id] = path.slice(ER_PREFIX.length).split(':')
  return { db: db ?? '', id: id ?? '' }
}

const VIEWS: Record<ViewKind, { is: (path: string) => boolean; icon: string; title: (path: string) => string }> = {
  graph: { is: (p) => p === GRAPH_TAB, icon: 'branch', title: () => 'Граф блокнота' },
  er: { is: (p) => p.startsWith(ER_PREFIX), icon: 'database', title: (p) => `ER · ${erTabOf(p).db}` },
}
export const viewKindOf = (path: string | undefined): ViewKind | undefined => (path ? VIEW_KINDS.find((k) => VIEWS[k].is(path)) : undefined)
export const isViewTab = (path: string | undefined): boolean => !!viewKindOf(path)
export const viewIcon = (path: string) => VIEWS[viewKindOf(path)!].icon
export const viewTitle = (path: string) => VIEWS[viewKindOf(path)!].title(path)
