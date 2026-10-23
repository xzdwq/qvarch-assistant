import { computed, ref, type Ref } from 'vue'
import { guessHeadRow, isEmptyGrid, type CellGrid, type ImportedBook } from '@shared/tableData'
import { importGrid } from '../modelImport'
import type { TableModel } from '../model'
import { bookOfGrid, IMPORT_SOURCE_DEFS, type ImportSourceId } from './importSources'

/**
 * A table's import: a book of sheets got from a source (a file, the clipboard — or a block pasted into a blank table),
 * a sheet chosen, «первая строка — заголовки» decided, the table replaced by it.
 */
export function useTableImport(t: Ref<TableModel>, save: (now?: boolean) => void) {
  /** The book being looked at (the dialog is open while there is one). */
  const book = ref<Extract<ImportedBook, { ok: true }>>()
  const sheetIndex = ref(0)
  const headRow = ref(true)
  /** Why the last source gave nothing (shown over the table). */
  const error = ref('')
  const sheet = computed(() => book.value?.sheets[sheetIndex.value])

  /** The book shown: its first sheet with data chosen, the head guessed from it. */
  function show(b: ImportedBook | undefined): void {
    error.value = ''
    if (!b) return
    if (!b.ok) return void (error.value = b.error)
    book.value = b
    const firstWithData = b.sheets.findIndex((s) => !isEmptyGrid(s.grid))
    pickSheet(Math.max(0, firstWithData))
  }
  function pickSheet(i: number): void {
    sheetIndex.value = i
    if (sheet.value) headRow.value = guessHeadRow(sheet.value.grid)
  }
  /** A source asked for (the export menu). */
  async function importFrom(source: ImportSourceId): Promise<void> {
    show(await IMPORT_SOURCE_DEFS[source].load())
  }
  /** Cells pasted into a blank table: asked how (their head) before they fill it. */
  const offerGrid = (grid: CellGrid) => show(bookOfGrid('Буфер обмена', grid))

  function apply(): void {
    const s = sheet.value
    if (!s || isEmptyGrid(s.grid)) return
    importGrid(t.value, s.grid, headRow.value)
    book.value = undefined
    save(true)
  }
  const cancel = () => void (book.value = undefined)
  return { book, sheet, sheetIndex, headRow, error, pickSheet, importFrom, offerGrid, apply, cancel }
}
