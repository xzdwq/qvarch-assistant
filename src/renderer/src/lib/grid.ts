import { computed, ref, watch, type Ref } from 'vue'
import type { MenuItem } from '../components/MenuButton.vue'
import type { GridData } from '@shared/gridData'
export { asGrid, type GridData } from '@shared/gridData'

/**
 * The notebook's table of values (a query's rows, a variable's data, a loop's rows gathered): its columns' widths
 * (fitted, dragged), cells chosen (a drag, Shift+click, a column by its head, a row by its number) and copied as
 * Excel takes them, JSON cells unfolded in place, the rows copied / saved as Excel or CSV. The state here, the
 * table drawn by DataGrid — a header of the block's own shows the count chosen and the export menu.
 */
export type Grid = ReturnType<typeof useGrid>

export const cellText = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const esc = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
/** The value as JSON when it is one (an object / an array; a text that parses as one). */
export function jsonOf(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return v
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return undefined
  try {
    const j = JSON.parse(v) as unknown
    return j !== null && typeof j === 'object' ? j : undefined
  } catch {
    return undefined
  }
}

export function useGrid(data: Ref<GridData | undefined>, fileName: () => string, limit = 300) {
  const shownRows = computed(() => data.value?.rows.slice(0, limit) ?? [])
  /** A column's width that fits its name, its type and its first rows (a long value — cut, shown whole on hover). */
  function fitWidth(i: number): number {
    const t = data.value
    if (!t) return 120
    const c = t.columns[i]
    const longest = Math.max(c.name.length, (c.type ?? '').length * 0.85, ...t.rows.slice(0, 200).map((r) => Math.min(60, cellText(r[i]).length)))
    return Math.round(Math.min(440, Math.max(56, longest * 7.4 + 22)))
  }
  /** The columns' widths (new columns — fitted; dragged by their border; a double click fits again). */
  const widths = ref<number[]>([])
  watch(
    () => data.value?.columns.map((c) => c.name).join('\u0000'),
    () => (widths.value = (data.value?.columns ?? []).map((_, i) => fitWidth(i))),
    { immediate: true },
  )
  const fit = (i: number) => (widths.value = widths.value.map((w, j) => (j === i ? fitWidth(i) : w)))
  function resize(e: PointerEvent, i: number): void {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = widths.value[i]
    const el = e.currentTarget as HTMLElement
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // (the pointer no longer down)
    }
    const move = (ev: PointerEvent) => (widths.value = widths.value.map((w, j) => (j === i ? Math.max(40, Math.round(w0 + ev.clientX - x0)) : w)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // ---------- choosing cells and copying them ----------
  type Sel = { r0: number; c0: number; r1: number; c1: number; head?: boolean }
  const sel = ref<Sel>()
  const box = ref<HTMLElement>()
  let anchor: { r: number; c: number } | undefined
  let dragging = false
  const inSel = (r: number, c: number) => {
    const x = sel.value
    return !!x && r >= Math.min(x.r0, x.r1) && r <= Math.max(x.r0, x.r1) && c >= Math.min(x.c0, x.c1) && c <= Math.max(x.c0, x.c1)
  }
  const lastRow = () => (data.value?.rows.length ?? 1) - 1
  const lastCol = () => (data.value?.columns.length ?? 1) - 1
  const focus = () => box.value?.focus({ preventScroll: true })
  function cellDown(e: PointerEvent, r: number, c: number): void {
    if (e.button !== 0) return
    e.preventDefault()
    focus()
    if (e.shiftKey && anchor) sel.value = { r0: anchor.r, c0: anchor.c, r1: r, c1: c }
    else {
      anchor = { r, c }
      sel.value = { r0: r, c0: c, r1: r, c1: c }
      dragging = true
      window.addEventListener('pointerup', () => (dragging = false), { once: true })
    }
  }
  function cellEnter(r: number, c: number): void {
    if (dragging && sel.value) sel.value = { ...sel.value, r1: r, c1: c }
  }
  /** A column by its head (Shift — from the one chosen before): all its rows — those not shown too. */
  function pickCol(e: MouseEvent, c: number): void {
    if ((e.target as Element).closest('.rz')) return
    focus()
    const c0 = e.shiftKey && sel.value?.head ? sel.value.c0 : c
    sel.value = { r0: 0, r1: lastRow(), c0, c1: c, head: true }
    anchor = { r: 0, c }
  }
  /** A row by its number (Shift — from the one chosen before). */
  function pickRow(e: MouseEvent, r: number): void {
    e.preventDefault()
    focus()
    const r0 = e.shiftKey && anchor ? anchor.r : r
    sel.value = { r0, r1: r, c0: 0, c1: lastCol() }
    if (!e.shiftKey) anchor = { r, c: 0 }
  }
  const pickAll = () => {
    focus()
    sel.value = { r0: 0, r1: lastRow(), c0: 0, c1: lastCol(), head: true }
  }
  /** The chosen cells as Excel takes them (whole columns — with their names over them). */
  function selText(): string {
    const t = data.value
    const x = sel.value
    if (!t || !x) return ''
    const [c0, c1] = [Math.min(x.c0, x.c1), Math.max(x.c0, x.c1)]
    const out: string[] = []
    if (x.head) out.push(t.columns.slice(c0, c1 + 1).map((c) => esc(c.name)).join('\t'))
    for (let r = Math.min(x.r0, x.r1); r <= Math.max(x.r0, x.r1); r++) out.push(t.rows[r].slice(c0, c1 + 1).map((v) => esc(v === null ? '' : cellText(v))).join('\t'))
    return out.join('\n')
  }
  const selCount = computed(() => (sel.value ? (Math.abs(sel.value.r1 - sel.value.r0) + 1) * (Math.abs(sel.value.c1 - sel.value.c0) + 1) : 0))
  const copied = ref(false)
  const flash = () => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
  function copySel(): void {
    void navigator.clipboard.writeText(selText())
    flash()
  }
  function onKey(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && sel.value) {
      e.preventDefault()
      copySel()
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault()
      pickAll()
    } else if (e.key === 'Escape') sel.value = undefined
  }

  // ---------- JSON cells: unfolded inside the cell ----------
  /** Which shown cells hold JSON (worked out once per data, not on every redraw). */
  const jsonCells = computed(() => shownRows.value.map((r) => r.map((v) => jsonOf(v) !== undefined)))
  const unfolded = ref(new Set<string>())
  const toggleJson = (r: number, c: number) => {
    const k = `${r}:${c}`
    const s = new Set(unfolded.value)
    if (s.has(k)) s.delete(k)
    else s.add(k)
    unfolded.value = s
  }
  const prettyJson = (v: unknown) => JSON.stringify(jsonOf(v), null, 2)

  /** A right click on a cell: its menu (a cell outside the chosen ones — chosen alone first). */
  const cellMenu = ref<{ x: number; y: number }>()
  function onCellMenu(e: MouseEvent, r: number, c: number): void {
    e.preventDefault()
    if (!inSel(r, c)) {
      anchor = { r, c }
      sel.value = { r0: r, c0: c, r1: r, c1: c }
    }
    focus()
    cellMenu.value = { x: e.clientX, y: e.clientY }
  }
  const cellItems = computed<MenuItem[]>(() => [{ label: selCount.value > 1 ? `Копировать (${selCount.value})` : 'Копировать', icon: 'copy', title: 'Ctrl+C — в Excel вставляется по столбцам', run: () => copySel() }])
  // other columns — nothing chosen, nothing unfolded; the same columns with rows added (a loop going on) — the choice
  // kept (cut to the rows there are)
  watch(
    () => data.value?.columns.map((c) => c.name).join('\u0000'),
    () => ((sel.value = undefined), (anchor = undefined), (unfolded.value = new Set())),
  )
  watch(
    () => data.value?.rows.length ?? 0,
    (n) => {
      const x = sel.value
      if (x && Math.max(x.r0, x.r1) >= n) sel.value = n ? { ...x, r0: Math.min(x.r0, n - 1), r1: Math.min(x.r1, n - 1) } : undefined
    },
  )

  // ---------- all the rows: copied, saved as a file ----------
  const exported = ref('')
  async function exportAs(format: 'xlsx' | 'csv'): Promise<void> {
    const t = data.value
    if (!t) return
    exported.value = ''
    const file = await window.qa.sql('exportRows', { format, name: fileName() || 'Результат', columns: JSON.parse(JSON.stringify(t.columns)), rows: JSON.parse(JSON.stringify(t.rows)) })
    if (file) exported.value = `Сохранено: ${file}`
  }
  /** The rows as tab-separated text (pasted into Excel — columns as they are). */
  async function copyTsv(): Promise<void> {
    const t = data.value
    if (!t) return
    await navigator.clipboard.writeText([t.columns.map((c) => esc(c.name)).join('\t'), ...t.rows.map((r) => r.map((v) => esc(cellText(v))).join('\t'))].join('\n'))
    flash()
  }
  const exportItems = computed<MenuItem[]>(() => [
    { label: 'Копировать', icon: 'copy', title: 'В буфер — вставляется в Excel по столбцам', run: copyTsv },
    { label: 'Сохранить в Excel (.xlsx)', icon: 'table', run: () => exportAs('xlsx') },
    { label: 'Сохранить в CSV (UTF-8)', icon: 'list', run: () => exportAs('csv') },
  ])

  return { data, limit, shownRows, widths, fit, resize, sel, box, inSel, cellDown, cellEnter, pickCol, pickRow, pickAll, selCount, copied, onKey, jsonCells, unfolded, toggleJson, prettyJson, cellMenu, onCellMenu, cellItems, exported, exportItems }
}
