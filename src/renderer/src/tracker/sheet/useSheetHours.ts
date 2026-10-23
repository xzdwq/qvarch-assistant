import { nextTick, ref, type Ref } from 'vue'
import { formatHours, parseHours, placeTime, takeTime, type RangeDay, type SheetRow } from '@shared/report'
import { atTime, scheduleRanges } from '@shared/timeline'
import type { PublicSettings } from '@shared/types'
import { nextCell, type CellMove, type SheetCell, type SheetGridRow } from '@shared/tracker/sheetRows'
import { vFocusSelect } from '../../lib/focusSelect'

/** Keys that commit a cell and move on (Enter is down, Shift+Enter up). */
const CELL_MOVES: Record<string, CellMove> = { ArrowDown: 'down', ArrowUp: 'up', Tab: 'right' }
/** Less than a minute of difference changes nothing. */
const MIN_CHANGE = 60_000

/** What typing hours needs from the sheet. */
export interface SheetHoursDeps {
  settings: () => PublicSettings
  rows: Ref<SheetGridRow[]>
  cols: Ref<string[]>
  dayOf: (d: string) => RangeDay | undefined
  load: () => Promise<void>
  busy: Ref<boolean>
}

/**
 * Typing hours into a cell: more time makes real blocks in the day's free working time, less takes time away
 * from the row's blocks (Outlook-only rows are locked). Enter / arrows / Tab commit and move to the next cell.
 */
export function useSheetHours(deps: SheetHoursDeps) {
  const editing = ref<string>()
  const draft = ref('')
  /** The cell that just refused its text (flashes). */
  const bad = ref<string>()
  const cellId = (r: SheetRow, d: string) => `${r.key}|${d}`

  function startEdit(r: SheetGridRow, d: string): void {
    if (r.locked) return
    editing.value = cellId(r, d)
    draft.value = formatHours(r.cells.get(d)?.ms ?? 0)
  }

  /** The working hours of a day (the schedule's, also on a day off — that is where hand-typed time goes). */
  function workOf(d: string): { work: [number, number]; lunch?: [number, number] } {
    const sch = deps.settings().schedule
    const s = scheduleRanges(d, sch)
    return { work: s.work ?? [atTime(d, sch.start), atTime(d, sch.end)], lunch: s.lunch ?? (sch.lunchStart && sch.lunchEnd ? [atTime(d, sch.lunchStart), atTime(d, sch.lunchEnd)] : undefined) }
  }

  /** Brings a row's time on a day to `want` ms: new blocks into free work time, or trims / drops its blocks. */
  async function setHours(r: SheetRow & { cells?: Map<string, SheetCell> }, d: string, want: number): Promise<void> {
    const cell = r.cells?.get(d)
    const diff = want - (cell?.ms ?? 0)
    if (Math.abs(diff) < MIN_CHANGE) return
    if (diff > 0) {
      const { work, lunch } = workOf(d)
      for (const [start, end] of placeTime(deps.dayOf(d)?.entries ?? [], diff, work, lunch))
        await window.qa.saveEntry(d, { start, end, kind: r.kind, label: r.label, task: r.task ? { ...r.task } : undefined, source: 'manual' }, { overlap: true })
      return
    }
    for (const op of takeTime(cell?.blocks ?? [], -diff)) {
      const e = cell!.blocks.find((b) => b.id === op.id)!
      if (op.drop) await window.qa.deleteEntry(d, e.id)
      else await window.qa.saveEntry(d, { ...e, task: e.task ? { ...e.task } : undefined, end: op.end! }, { overlap: true })
    }
  }

  /** Saves the cell being typed (a bad text flashes and stays), then moves on if asked. */
  async function commit(r: SheetGridRow, d: string, move?: CellMove): Promise<void> {
    if (editing.value !== cellId(r, d)) return
    const ms = parseHours(draft.value)
    if (ms === undefined) {
      bad.value = cellId(r, d)
      setTimeout(() => (bad.value = undefined), 900)
      return
    }
    editing.value = undefined
    if (Math.abs(ms - (r.cells.get(d)?.ms ?? 0)) >= MIN_CHANGE) {
      deps.busy.value = true
      try {
        await setHours(r, d, ms)
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err))
      } finally {
        await deps.load()
        deps.busy.value = false
      }
    }
    if (move) void focusNext(r, d, move)
  }

  function cancel(): void {
    editing.value = undefined
  }

  async function focusNext(r: SheetGridRow, d: string, move: CellMove): Promise<void> {
    const next = nextCell(deps.rows.value, deps.cols.value, r.key, d, move)
    if (!next) return
    startEdit(next.row, next.day)
    await nextTick()
    const el = document.querySelector<HTMLInputElement>('.sheet input.cin')
    el?.focus()
    el?.select()
  }

  function onCellKey(e: KeyboardEvent, r: SheetGridRow, d: string): void {
    if (e.key === 'Escape') return cancel()
    if (e.key === 'Tab' && e.shiftKey) return
    const move = e.key === 'Enter' ? (e.shiftKey ? 'up' : 'down') : CELL_MOVES[e.key]
    if (!move) return
    if (e.key === 'Tab') e.preventDefault()
    void commit(r, d, move)
  }

  /** The cell input takes the focus and selects its text when it appears. */
  const vFocus = vFocusSelect

  return { editing, draft, bad, cellId, startEdit, setHours, commit, onCellKey, vFocus }
}
