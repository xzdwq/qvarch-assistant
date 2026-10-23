import { onBeforeUnmount, type Ref } from 'vue'
import { gridFromClipboard, isTableClipboard, type CellGrid } from '@shared/tableData'
import { rangeBounds, type CellRange } from '@shared/gridRange'
import type { TableModel } from '../model'
import { isBlankTable, pasteGrid } from '../modelImport'

/** Where the table is pasted into: the cells chosen, the cell typed in. */
interface PasteTarget {
  sel: Ref<CellRange | undefined>
  edit: Ref<{ r: number; c: number } | undefined>
}

/**
 * Ctrl+V of cells copied from a spreadsheet into the table: from the cell typed in (or the first of the chosen ones)
 * they fill the table as Excel pastes, the table growing, merged cells coming along; into a blank table — asked
 * first whether the first row is the head (`offer`). A line or a single value is pasted into the cell as text.
 */
export function useTablePaste(t: Ref<TableModel>, save: (now?: boolean) => void, root: Ref<HTMLElement | undefined>, target: PasteTarget, offer: (grid: CellGrid) => void) {
  /** The cell the paste starts at: the chosen cells' first, else the one typed in; neither — not this table's paste. */
  function startCell(e: ClipboardEvent): { r: number; c: number } | undefined {
    if (target.sel.value) {
      const b = rangeBounds(target.sel.value)
      return { r: b.top, c: b.left }
    }
    const inside = e.target instanceof Node && !!root.value?.contains(e.target)
    return inside ? target.edit.value : undefined
  }

  function onPaste(e: ClipboardEvent): void {
    const at = startCell(e)
    if (!at || !e.clipboardData) return
    const clip = { html: e.clipboardData.getData('text/html') || undefined, text: e.clipboardData.getData('text/plain') || undefined }
    if (!isTableClipboard(clip)) return
    const grid = gridFromClipboard(clip)
    if (!grid) return
    e.preventDefault()
    e.stopPropagation()
    if (isBlankTable(t.value)) return offer(grid)
    pasteGrid(t.value, grid, at)
    target.sel.value = undefined
    save(true)
  }
  window.addEventListener('paste', onPaste, true)
  onBeforeUnmount(() => window.removeEventListener('paste', onPaste, true))
}
