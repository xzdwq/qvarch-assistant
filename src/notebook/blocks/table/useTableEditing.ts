import { nextTick, ref, type Ref } from 'vue'
import { addColumn, deleteRowAt, insertRowAt, removeColumn, setColumnTotal, sortRowsBy, type Align, type TableModel, type TotalKind } from './model'

/**
 * Typing in the table: only the cell being typed in is a field — the others are their text (a table of hundreds of
 * cells stays light). Tab — the next cell, Enter — the one below (a new row at the end), ↑ / ↓ across lines and out
 * of the table, Esc — out. And what changes its shape: rows, columns, alignment, order, totals.
 */
export function useTableEditing(t: Ref<TableModel>, save: (now?: boolean) => void, root: Ref<HTMLElement | undefined>, exit: (dir: 1 | -1) => void) {
  const cols = () => t.value.head.length
  const cellEl = (r: number, c: number): HTMLTextAreaElement | null => root.value?.querySelector(`[data-rc="${r}:${c}"]`) ?? null

  const edit = ref<{ r: number; c: number }>()
  const isEdit = (r: number, c: number) => edit.value?.r === r && edit.value.c === c
  function leaveCell(r: number, c: number): void {
    save(true)
    if (isEdit(r, c)) edit.value = undefined
  }
  /** The cell becomes a field, the caret at its end (or its start). Row -1 — the head. */
  async function focusCell(r: number, c: number, end = true): Promise<void> {
    edit.value = { r, c }
    await nextTick()
    const el = cellEl(r, c)
    if (!el) return
    el.focus()
    const p = end ? el.value.length : 0
    el.setSelectionRange(p, p)
  }
  function onKey(e: KeyboardEvent, r: number, c: number): void {
    const el = e.target as HTMLTextAreaElement
    const rows = t.value.rows.length
    switch (e.key) {
      case 'Tab': {
        e.preventDefault()
        let nr = r
        let nc = c + (e.shiftKey ? -1 : 1)
        if (nc >= cols()) ((nc = 0), nr++)
        if (nc < 0) ((nc = cols() - 1), nr--)
        if (nr > rows) addRow(rows)
        if (nr < -1) return
        void focusCell(nr, nc)
        break
      }
      case 'Enter':
        if (e.shiftKey) return
        e.preventDefault()
        if (r === rows - 1 || (r === -1 && !rows)) addRow(rows)
        void focusCell(r + 1, c)
        break
      // arrows leave the cell only from its first / last line
      case 'ArrowUp':
        if (el.value.slice(0, el.selectionStart).includes('\n')) return
        e.preventDefault()
        if (r === -1) exit(-1)
        else void focusCell(r - 1, c)
        break
      case 'ArrowDown':
        if (el.value.slice(el.selectionEnd).includes('\n')) return
        e.preventDefault()
        if (r === rows - 1) exit(1)
        else void focusCell(r + 1, c)
        break
      case 'Escape':
        e.preventDefault()
        exit(1)
        break
    }
  }
  function setCell(r: number, c: number, v: string): void {
    if (r === -1) t.value.head[c] = v
    else t.value.rows[r][c] = v
    save()
  }

  // ---------- the table's shape ----------
  function addRow(at: number): void {
    insertRowAt(t.value, at)
    save(true)
  }
  function delRow(at: number): void {
    if (!t.value.rows.length) return
    deleteRowAt(t.value, at)
    save(true)
  }
  function addCol(at: number): void {
    addColumn(t.value, at)
    save(true)
  }
  function delCol(at: number): void {
    if (removeColumn(t.value, at)) save(true)
  }
  /** The total under a column set (the same one again — taken away). */
  function setTotal(c: number, kind: TotalKind | undefined): void {
    setColumnTotal(t.value, c, kind)
    save(true)
  }
  function setAlign(c: number, a: Align): void {
    t.value.align[c] = a
    save(true)
  }
  function sortBy(c: number, dir: 1 | -1): void {
    if (sortRowsBy(t.value, c, dir)) save(true)
  }
  return { edit, isEdit, leaveCell, focusCell, onKey, setCell, addRow, delRow, addCol, delCol, setTotal, setAlign, sortBy }
}
