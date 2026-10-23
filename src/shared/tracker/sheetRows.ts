import { rowKeyOf, rowOf, type RangeDay, type SheetRow } from '../report'
import { unionMs } from '../timeline'
import type { Entry } from '../types'

/** One day's cell of a row: its blocks and their time (overlaps counted once). */
export interface SheetCell {
  ms: number
  blocks: Entry[]
}

/** A row of the sheet with its cells per day and its total. */
export interface SheetGridRow extends SheetRow {
  cells: Map<string, SheetCell>
  total: number
  /** Only Outlook meetings — nothing to change here. */
  locked: boolean
  /** Added by hand (not from blocks). */
  manual: boolean
}

/**
 * Rows from the blocks of the days (only the kinds shown) plus the ones added by hand: tasks first, then by
 * the kind's order and the task key / text.
 */
export function buildSheetRows(days: RangeDay[], added: SheetRow[], shownKind: (kind: string) => boolean, kindOrder: (kind: string) => number): SheetGridRow[] {
  const m = new Map<string, SheetGridRow>()
  const ensure = (r: SheetRow, manual: boolean): SheetGridRow => {
    let row = m.get(r.key)
    if (!row) m.set(r.key, (row = { ...r, cells: new Map(), total: 0, locked: false, manual }))
    return row
  }
  for (const d of days)
    for (const e of d.entries.filter((x) => shownKind(x.kind))) {
      const row = ensure(rowOf(e), false)
      const c = row.cells.get(d.day) ?? { ms: 0, blocks: [] }
      c.blocks.push(e)
      row.cells.set(d.day, c)
    }
  for (const r of added) if (shownKind(r.kind)) ensure(r, true)
  for (const row of m.values()) {
    for (const c of row.cells.values()) c.ms = unionMs(c.blocks)
    const blocks = [...row.cells.values()].flatMap((c) => c.blocks)
    row.total = unionMs(blocks)
    row.locked = blocks.length > 0 && blocks.every((b) => b.outlook)
  }
  return [...m.values()].sort((a, b) => Number(!a.task) - Number(!b.task) || kindOrder(a.kind) - kindOrder(b.kind) || (a.task?.key ?? a.label).localeCompare(b.task?.key ?? b.label))
}

/** Time of one kind per day and for the period — the kind's own overlaps counted once. */
export interface SheetKindRow {
  kind: string
  per: Map<string, number>
  total: number
}

/**
 * Time per kind (tasks, meetings, calls…) over the columns: the configured kinds present, in their order,
 * then kinds removed from the settings but still on old blocks.
 */
export function kindTotals(cols: string[], entriesOf: (day: string) => Entry[], kindIds: string[]): SheetKindRow[] {
  const present = new Set(cols.flatMap((d) => entriesOf(d).map((e) => e.kind)))
  const rowOfKind = (kind: string): SheetKindRow => {
    const per = new Map(cols.map((d) => [d, unionMs(entriesOf(d).filter((e) => e.kind === kind))]))
    return { kind, per, total: [...per.values()].reduce((a, b) => a + b, 0) }
  }
  return [...kindIds.filter((id) => present.has(id)), ...[...present].filter((id) => !kindIds.includes(id))].map(rowOfKind)
}

/** Where the cursor goes from a cell: the row below / above, or the next day. */
export type CellMove = 'down' | 'up' | 'right'

/** The cell after a move; undefined at the table's edge or on a locked row. */
export function nextCell<R extends { key: string; locked: boolean }>(rows: R[], cols: string[], rowKey: string, day: string, move: CellMove): { row: R; day: string } | undefined {
  const ri = rows.findIndex((x) => x.key === rowKey)
  const ci = cols.indexOf(day)
  const step = { down: [1, 0], up: [-1, 0], right: [0, 1] }[move]
  const row = rows[ri + step[0]]
  const d = cols[ci + step[1]]
  return row && d && !row.locked ? { row, day: d } : undefined
}

/** A block of time to add: a row's hours on a day. */
export interface SheetFill {
  row: SheetRow
  day: string
  ms: number
}

/**
 * The previous period copied onto `cols`: its rows (what came by itself — meetings, found calls — is not
 * copied) and, per day, their time where the current cell is still empty (at least a minute).
 */
export function copyFromPrevious(prev: RangeDay[], prevCols: string[], cols: string[], currentMs: (rowKey: string, day: string) => number): { rows: SheetRow[]; fills: SheetFill[] } {
  const own = prev.flatMap((d) => d.entries.filter((e) => !e.outlook && e.source !== 'detected').map((e) => ({ day: d.day, e })))
  const rows = new Map<string, SheetRow>()
  for (const { e } of own) rows.set(rowKeyOf(e), rowOf(e))
  const fills: SheetFill[] = []
  for (const [key, row] of rows)
    prevCols.forEach((pd, i) => {
      const ms = unionMs(own.filter((x) => x.day === pd && rowKeyOf(x.e) === key).map((x) => x.e))
      const d = cols[i]
      if (ms >= 60_000 && currentMs(key, d) === 0) fills.push({ row, day: d, ms })
    })
  return { rows: [...rows.values()], fills }
}
