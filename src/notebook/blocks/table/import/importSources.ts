import { gridFromClipboard, type CellGrid, type ImportedBook } from '@shared/tableData'

/** Where a table's cells come from when imported. */
export const IMPORT_SOURCES = ['file', 'clipboard'] as const
export type ImportSourceId = (typeof IMPORT_SOURCES)[number]

/** A source: its menu item, and how it gives a book of sheets (cancelled — undefined). */
export interface ImportSource {
  label: string
  icon: string
  title: string
  load: () => Promise<ImportedBook | undefined>
}

/** A grid as a book of one sheet (what was copied). */
export const bookOfGrid = (name: string, grid: CellGrid): ImportedBook => ({ ok: true, name, sheets: [{ name, grid }] })

/** The sources, each in one place. */
export const IMPORT_SOURCE_DEFS: Record<ImportSourceId, ImportSource> = {
  file: {
    label: 'Импорт из Excel / CSV…',
    icon: 'upload',
    title: 'Файл .xlsx или .csv: лист целиком, объединённые ячейки сохраняются',
    load: () => window.qa.tableFile('importFile'),
  },
  clipboard: {
    label: 'Вставить из буфера…',
    icon: 'clipboard',
    title: 'Ячейки, скопированные в Excel / Google Таблицах: с выбором, заголовок ли первая строка',
    load: async () => {
      const grid = gridFromClipboard(await window.qa.tableFile('readClipboard'))
      return grid ? bookOfGrid('Буфер обмена', grid) : { ok: false, error: 'В буфере нет таблицы — скопируйте ячейки в Excel' }
    },
  },
}
