import { computed, ref, shallowRef, type Ref } from 'vue'
import type { Edge, Node } from '@vue-flow/core'
import { erAround, erKey, erTablesNamed, type ErSchema } from '@shared/sql'
import { remoteError } from '@shared/remoteError'
import { sqlTables } from '@nb/domain/graph/sqlTables'
import { edgesOf, layoutEr, nodeOf, sizeOf, stopLayout, type ErEdgeData, type ErNodeData } from './erLayout'

/** What the diagram is built of: the query's tables, tables picked by hand, the whole database. */
export const ER_MODES = ['query', 'picked', 'all'] as const
export type ErMode = (typeof ER_MODES)[number]
/** How far the neighbours go: none, one reference, two. */
export const ER_DEPTHS = [0, 1, 2] as const
/** Past this many tables the diagram is asked for once more (its layout takes a while). */
export const ER_BIG = 150
/** The room kept between a card put on and the others, px. */
const GAP = 24

/**
 * The ER panel of a query block: nothing is read until a button is pressed — then the database's structure is read
 * (in a process of its own, the safe way any query is; stopped — cancelled on the server), the tables chosen (the
 * query's, picked, all — with their neighbours), a big diagram asked for once more, laid out (in a worker; stopped —
 * the worker ended), shown.
 */
export function useSqlEr(o: { db: () => string | undefined; sql: () => string }) {
  /** Where it is: nothing yet, reading the structure, asked to confirm a big one, picking tables, laying out, shown, failed. */
  const phase = ref<'idle' | 'read' | 'confirm' | 'pick' | 'layout' | 'ready' | 'error'>('idle')
  const mode = ref<ErMode>('query')
  /** The neighbours: none at first (the tables asked for alone). */
  const depth = ref<number>(0)
  const picked = ref<string[]>([])
  const schema = shallowRef<ErSchema>()
  const error = ref('')
  /**
   * The cards (two-way with the diagram: a card dragged keeps its place here). Typed as a plain Ref: unwrapping Vue
   * Flow's node type sends tsc into its depths (TS2589) — reactive as deep as any ref.
   */
  const nodes = ref([]) as Ref<Node<ErNodeData>[]>
  const edges = shallowRef<Edge<ErEdgeData>[]>([])
  /** The tables to draw (asked for and their neighbours). */
  const keys = ref<string[]>([])
  const runId = `er#${Math.random().toString(36).slice(2, 10)}`
  /** A step stopped / overtaken: its answer is not used. */
  let seq = 0

  /** The tables a query names, found in the schema. */
  const queryTables = (s: ErSchema) =>
    erTablesNamed(
      s,
      sqlTables(o.sql()).map((t) => {
        const parts = t.label.split('.')
        return { name: parts[parts.length - 1], ...(parts.length > 1 ? { schema: parts[parts.length - 2] } : {}) }
      }),
    )
  /** The tables asked for in the mode chosen. */
  const asked = (s: ErSchema): string[] => (mode.value === 'all' ? s.tables.map(erKey) : mode.value === 'picked' ? picked.value : queryTables(s))

  /** Built anew (a button): the structure read (kept a few minutes in the app; `fresh` — read again), then on. */
  async function build(m: ErMode, fresh = false): Promise<void> {
    const db = o.db()
    if (!db) return void ((phase.value = 'error'), (error.value = 'Не выбрано подключение'))
    mode.value = m
    const my = ++seq
    error.value = ''
    if (!schema.value || fresh) {
      phase.value = 'read'
      const r = await window.qa.sql('er', runId, db, fresh).catch((e: unknown) => ({ error: remoteError(e) }))
      if (my !== seq) return
      if ('error' in r) return void ((phase.value = 'error'), (error.value = r.error))
      schema.value = r
    }
    if (m === 'picked') return void (phase.value = 'pick')
    await draw(false)
  }
  /** The tables chosen drawn (`sure` — a big diagram confirmed). */
  async function draw(sure: boolean): Promise<void> {
    const s = schema.value
    if (!s) return
    const want = asked(s)
    if (mode.value === 'query' && !want.length) return void ((phase.value = 'error'), (error.value = 'В запросе не нашлось таблиц этой базы — выберите таблицы сами («Выбрать таблицы…»)'))
    const all = mode.value === 'all' ? want : erAround(s, want, depth.value)
    if (all.length > ER_BIG && !sure) {
      keys.value = all
      return void (phase.value = 'confirm')
    }
    keys.value = all
    const my = ++seq
    phase.value = 'layout'
    try {
      const out = await layoutEr(s, all, new Set(want))
      if (my !== seq) return
      nodes.value = out.nodes
      edges.value = out.edges
      phase.value = 'ready'
    } catch (e) {
      if (my !== seq) return
      phase.value = 'error'
      error.value = `Не разложить схему: ${remoteError(e)}`
    }
  }
  /** Stopped (whatever goes on): the reading cancelled on the server, the layout's worker ended. */
  function stop(): void {
    seq++
    if (phase.value === 'read') void window.qa.sql('stop', runId)
    if (phase.value === 'layout') stopLayout()
    phase.value = 'error'
    error.value = 'Остановлено'
  }
  /** The panel closed: anything going on stopped, the diagram dropped (the structure kept for the next time). */
  function close(): void {
    if (phase.value === 'read' || phase.value === 'layout') stop()
    phase.value = 'idle'
    nodes.value = []
    edges.value = []
  }
  // ---------- a table taken off / put on the diagram as it is (nothing else moves) ----------
  /** The tables a table references or is referenced by that are not on the diagram. */
  function linkedOff(table: string): string[] {
    const s = schema.value
    if (!s) return []
    const on = new Set(keys.value)
    return [...new Set(erAround(s, [table], 1))].filter((k) => !on.has(k)).sort()
  }
  function remove(table: string): void {
    const s = schema.value
    if (!s) return
    keys.value = keys.value.filter((k) => k !== table)
    nodes.value = nodes.value.filter((n) => n.id !== table)
    edges.value = edgesOf(s, keys.value)
  }
  /** Put beside the card it was asked from, on a free place (right of it, else left; lower and lower until none overlaps). */
  function add(table: string, beside: string): void {
    const s = schema.value
    const t = s?.tables.find((x) => erKey(x) === table)
    const from = nodes.value.find((n) => n.id === beside)
    if (!s || !t || !from || keys.value.includes(table)) return
    const box = (n: Node<ErNodeData>) => ({ x: n.position.x, y: n.position.y, ...sizeOf(s, n.data!.table) })
    const own = sizeOf(s, t)
    const f = box(from)
    const free = (x: number, y: number) => nodes.value.every((n) => {
      const b = box(n)
      return x + own.w + GAP <= b.x || b.x + b.w + GAP <= x || y + own.h + GAP <= b.y || b.y + b.h + GAP <= y
    })
    const place = [f.x + f.w + 90, f.x - own.w - 90].flatMap((x) => Array.from({ length: 200 }, (_, i) => ({ x, y: f.y + i * 40 }))).find((p) => free(p.x, p.y)) ?? { x: f.x + f.w + 90, y: f.y }
    keys.value = [...keys.value, table]
    nodes.value = [...nodes.value, nodeOf(s, t, false, place)]
    edges.value = edgesOf(s, keys.value)
  }

  /** Built again as it was asked (a button: a tab kept from before the app's restart reads nothing by itself). */
  async function rebuild(): Promise<void> {
    await build(mode.value)
    if (mode.value === 'picked' && phase.value === 'pick' && picked.value.length) await draw(false)
  }

  const busy = computed(() => phase.value === 'read' || phase.value === 'layout')
  return { phase, mode, depth, picked, schema, error, nodes, edges, keys, busy, build, draw, stop, close, linkedOff, remove, add, rebuild }
}
export type SqlEr = ReturnType<typeof useSqlEr>
