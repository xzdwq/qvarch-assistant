import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type { MenuItem } from '@renderer/components/MenuButton.vue'
import { rangeBounds, rangeHas, rangeSize, type CellRange } from '@shared/gridRange'
import { clearRange, mergeAt, mergeCells, rangeText, unmergeCell, type TableModel } from './model'

/** What the selection needs of the cells being typed in. */
interface CellFocus {
  isEdit: (r: number, c: number) => boolean
  focusCell: (r: number, c: number) => Promise<void>
}

/**
 * Cells chosen — dragged over, or Shift+click from the cell typed in last: merged (a merged cell typed in —
 * unmerged), copied as Excel takes them (Ctrl+C, the right-click menu), emptied. Esc or a click elsewhere — none.
 */
export function useTableSelection(t: Ref<TableModel>, save: (now?: boolean) => void, root: Ref<HTMLElement | undefined>, cells: CellFocus) {
  const sel = ref<CellRange>()
  let downAt: { r: number; c: number } | undefined
  /** The cell typed in last — Shift+click chooses from it. */
  let lastCell: { r: number; c: number } | undefined
  const inSel = (r: number, c: number) => rangeHas(sel.value, r, c)
  const selCells = computed(() => rangeSize(sel.value))
  const blurField = () => (document.activeElement as HTMLElement | null)?.blur()

  function cellDown(e: PointerEvent, r: number, c: number): void {
    if (e.button !== 0) return
    if (e.shiftKey && lastCell && lastCell.r >= 0) {
      e.preventDefault()
      sel.value = { r0: lastCell.r, c0: lastCell.c, r1: r, c1: c }
      blurField()
      return
    }
    sel.value = undefined
    downAt = { r, c }
    window.addEventListener('pointerup', cellUp, { once: true })
  }
  function cellEnter(r: number, c: number): void {
    if (!downAt || (downAt.r === r && downAt.c === c && !sel.value)) return
    sel.value = { r0: downAt.r, c0: downAt.c, r1: r, c1: c }
    blurField()
    getSelection()?.removeAllRanges()
  }
  function cellUp(): void {
    const at = downAt
    downAt = undefined
    // a click (no cells dragged over): the cell is typed in — unless it already is (the caret goes where clicked)
    if (at && !sel.value && !cells.isEdit(at.r, at.c)) void cells.focusCell(at.r, at.c)
  }

  function doMerge(): void {
    const x = sel.value
    if (!x) return
    mergeCells(t.value, x.r0, x.c0, x.r1, x.c1)
    sel.value = undefined
    save(true)
    const b = rangeBounds(x)
    void cells.focusCell(b.top, b.left)
  }
  /** The merged cell being typed in (its button «Разъединить»). */
  const curMerge = ref<{ r: number; c: number }>()
  function doUnmerge(): void {
    if (!curMerge.value) return
    unmergeCell(t.value, curMerge.value.r, curMerge.value.c)
    curMerge.value = undefined
    save(true)
  }
  /** A cell typed in: Shift+click chooses from it; a merged one offers «Разъединить». */
  function onFocusCell(r: number, c: number): void {
    lastCell = { r, c }
    curMerge.value = r >= 0 && mergeAt(t.value, r, c) ? { r, c } : undefined
  }
  const copySel = () => navigator.clipboard.writeText(rangeText(t.value, sel.value!))
  function clearSel(): void {
    if (!sel.value) return
    clearRange(t.value, sel.value)
    save(true)
  }

  /** A right click over chosen cells: their menu (with no cells chosen — the text's own menu in the cell). */
  const cellMenu = ref<{ x: number; y: number }>()
  function onCellMenu(e: MouseEvent, r: number, c: number): void {
    if (!sel.value || selCells.value < 2) return
    if (!inSel(r, c)) sel.value = { r0: r, c0: c, r1: r, c1: c }
    e.preventDefault()
    cellMenu.value = { x: e.clientX, y: e.clientY }
  }
  const cellItems = computed<MenuItem[]>(() => [
    { label: `Копировать (${selCells.value})`, icon: 'copy', title: 'Ctrl+C — в Excel вставляется по столбцам', run: copySel },
    { label: 'Объединить', icon: 'layers', disabled: selCells.value < 2, run: doMerge },
    { label: 'Очистить', icon: 'trash', title: 'Значения выбранных ячеек — пустые', run: clearSel },
  ])

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && sel.value) sel.value = undefined
    // Ctrl+C over chosen cells: their values copied
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && sel.value && !(document.activeElement instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      void copySel()
    }
  }
  const onAway = (e: PointerEvent) => {
    // (the chosen cells' own menu is not «elsewhere»)
    if (!root.value?.contains(e.target as Node) && !(e.target as Element).closest?.('.cx-menu')) {
      sel.value = undefined
      curMerge.value = undefined
    }
  }
  window.addEventListener('keydown', onEsc)
  window.addEventListener('pointerdown', onAway, true)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onEsc)
    window.removeEventListener('pointerdown', onAway, true)
  })
  return { sel, inSel, selCells, cellDown, cellEnter, doMerge, curMerge, doUnmerge, onFocusCell, cellMenu, onCellMenu, cellItems }
}
