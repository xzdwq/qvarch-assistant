import ELK from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url'
import type { Edge, Node } from '@vue-flow/core'
import { erKey, erLabel, erLinks, erTypeKind, type ErLine, type ErSchema, type ErTable, type ErTypeKind } from '@shared/sql'

/**
 * The ER diagram laid out: each table a card (its height by its columns, its width by its longest line), a port on
 * each side of each column — a reference goes from its column to the column it points to; ELK's layered layout in a
 * worker of its own (a big database never holds the window; stopped — the worker ended). Then the cards and the lines
 * as Vue Flow takes them; a card added later is put beside the one it was asked from (nothing else moves).
 */
export const ROW_H = 22
export const HEAD_H = 32
const CHAR_W = 7.2
const MIN_W = 190
const MAX_W = 460

export interface ErNodeData {
  table: ErTable
  label: string
  /** Picked (from the query or by hand) — else a neighbour drawn for its references. */
  picked: boolean
}
/** A line's own data: the columns it joins, the kind of the referring column's type (its colour). */
export type ErEdgeData = ErLine & { optional: boolean; kind: ErTypeKind }

const widthOf = (t: ErTable, label: string) =>
  Math.round(Math.min(MAX_W, Math.max(MIN_W, label.length * CHAR_W + 60, ...t.columns.map((c) => (c.name.length + (c.type?.length ?? 0)) * CHAR_W + 90))))
const heightOf = (t: ErTable) => HEAD_H + t.columns.length * ROW_H + 6
const portY = (i: number) => HEAD_H + i * ROW_H + ROW_H / 2
export const sizeOf = (s: ErSchema, t: ErTable) => ({ w: widthOf(t, erLabel(t, s.defaultSchema)), h: heightOf(t) })

/** A table's card at a place. */
export function nodeOf(s: ErSchema, t: ErTable, picked: boolean, position: { x: number; y: number }): Node<ErNodeData> {
  const { w, h } = sizeOf(s, t)
  return { id: erKey(t), type: 'table', position, data: { table: t, label: erLabel(t, s.defaultSchema), picked }, style: { width: `${w}px`, height: `${h}px` } }
}
/** The lines between the tables shown: from a referring column to the one it points to. */
export function edgesOf(s: ErSchema, keys: readonly string[]): Edge<ErEdgeData>[] {
  const keep = new Set(keys)
  const typeOf = new Map(s.tables.map((t) => [erKey(t), new Map(t.columns.map((c) => [c.name, c.type]))]))
  return erLinks(s)
    .filter((l) => keep.has(l.from) && keep.has(l.to) && l.toColumn)
    .map((l) => {
      const id = `${l.from}|${l.fromColumn}>${l.to}|${l.toColumn}`
      const kind = erTypeKind(typeOf.get(l.from)?.get(l.fromColumn))
      return {
        id,
        source: l.from,
        target: l.to,
        sourceHandle: `${l.fromColumn}-s`,
        targetHandle: `${l.toColumn}-t`,
        type: 'smoothstep',
        class: l.optional ? 'er-optional' : '',
        data: { id, fromTable: l.from, fromColumn: l.fromColumn, toTable: l.to, toColumn: l.toColumn!, optional: l.optional, kind },
      }
    })
}

/** A layout running (one at a time): its worker, to end it. */
let running: InstanceType<typeof ELK> | undefined
/** The layout running — stopped (its worker ended). */
export function stopLayout(): void {
  running?.terminateWorker()
  running = undefined
}

/** The tables `keys` of the schema laid out (`picked` — the ones asked for, the rest their neighbours). */
export async function layoutEr(s: ErSchema, keys: readonly string[], picked: ReadonlySet<string>): Promise<{ nodes: Node<ErNodeData>[]; edges: Edge<ErEdgeData>[] }> {
  const keep = new Set(keys)
  const tables = s.tables.filter((t) => keep.has(erKey(t)))
  const edges = edgesOf(s, keys)
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      // the tables not linked to any — packed beside, not in one long row
      'elk.separateConnectedComponents': 'true',
    },
    children: tables.map((t) => {
      const k = erKey(t)
      const { w, h } = sizeOf(s, t)
      return {
        id: k,
        width: w,
        height: h,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: t.columns.flatMap((c, i) => [
          { id: `${k}|${c.name}|w`, x: 0, y: portY(i), width: 1, height: 1 },
          { id: `${k}|${c.name}|e`, x: w - 1, y: portY(i), width: 1, height: 1 },
        ]),
      }
    }),
    edges: edges.map((e) => ({ id: e.id, sources: [`${e.data!.fromTable}|${e.data!.fromColumn}|e`], targets: [`${e.data!.toTable}|${e.data!.toColumn}|w`] })),
  }
  stopLayout()
  const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) })
  running = elk
  try {
    const out = await elk.layout(graph)
    const at = new Map((out.children ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
    return { nodes: tables.map((t) => nodeOf(s, t, picked.has(erKey(t)), at.get(erKey(t)) ?? { x: 0, y: 0 })), edges }
  } finally {
    if (running === elk) {
      elk.terminateWorker()
      running = undefined
    }
  }
}
