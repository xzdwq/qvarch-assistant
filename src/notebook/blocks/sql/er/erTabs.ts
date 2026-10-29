import { layout, openFile } from '@nb/workspace/paneLayout'
import { erTabOf, erTabPath, viewKindOf } from '@nb/workspace/viewTabs'
import type { Node } from '@vue-flow/core'
import { useSqlEr, type ErMode, type SqlEr } from './useSqlEr'
import type { ErNodeData } from './erLayout'

/**
 * ER diagrams in tabs of their own: a block's diagram moved there as it is (its cards where they were dragged) — the
 * block's panel closed. A tab keeps what it was built of (the connection, how, the tables, the query) — after the app's
 * restart it shows that and builds it again only when asked (nothing is read from a database by itself).
 */
interface Kept {
  mode: ErMode
  depth: number
  picked: string[]
  sql: string
}
const KEY = 'qa.er.tabs'
const live = new Map<string, SqlEr>()
function readKept(): Record<string, Kept> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Kept>) ?? {}
  } catch {
    return {}
  }
}
function writeKept(all: Record<string, Kept>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // kept for this run only
  }
}
/** A diagram's state taken over as it is (its cards where they were dragged; one still being built — not). */
function adopt(to: SqlEr, from: SqlEr): void {
  to.mode.value = from.mode.value
  to.depth.value = from.depth.value
  to.picked.value = [...from.picked.value]
  to.schema.value = from.schema.value
  to.error.value = from.error.value
  to.keys.value = [...from.keys.value]
  // (each card its own copy: dragged in the tab, the block's would not move)
  const cards: Node<ErNodeData>[] = (from.nodes.value as Node<ErNodeData>[]).map((n) => ({ ...n, position: { ...n.position } }))
  ;(to.nodes as { value: Node<ErNodeData>[] }).value = cards
  to.edges.value = from.edges.value
  to.phase.value = from.busy.value ? 'idle' : from.phase.value
}
/** The tabs there are (a closed one's record dropped). */
const openIds = () => new Set(layout.panes.flatMap((p) => p.tabs.map((t) => t.path)).filter((p) => viewKindOf(p) === 'er').map((p) => erTabOf(p).id))

/** A block's diagram moved into a tab of its own (`db` — its connection, `sql` — its query); the block's panel closed. */
export function openErTab(from: SqlEr, db: string, sql: string): void {
  const id = Math.random().toString(36).slice(2, 10)
  const er = useSqlEr({ db: () => db, sql: () => sql })
  adopt(er, from)
  live.set(id, er)
  const open = openIds()
  const kept = Object.fromEntries(Object.entries(readKept()).filter(([k]) => open.has(k)))
  writeKept({ ...kept, [id]: { mode: from.mode.value, depth: from.depth.value, picked: [...from.picked.value], sql } })
  from.close()
  openFile(erTabPath(db, id))
}

/** A tab's diagram: the one moved there this run, or one made of what the tab kept (not built yet). */
export function erOfTab(path: string): SqlEr {
  const { db, id } = erTabOf(path)
  const had = live.get(id)
  if (had) return had
  const k = readKept()[id]
  const er = useSqlEr({ db: () => db, sql: () => k?.sql ?? '' })
  if (k) {
    er.mode.value = k.mode
    er.depth.value = k.depth
    er.picked.value = k.picked
  }
  live.set(id, er)
  return er
}
