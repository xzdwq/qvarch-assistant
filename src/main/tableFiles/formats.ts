import { rowsCsv, type ImportedSheet, type RowsColumn, type TableFileFormat } from '../../shared/tableData'
import { readDelimited } from './delimitedFile'
import { readXlsx, rowsXlsx } from './xlsx'

/** A format of table files: its extensions (the first — what is written), the dialog's name, its writer and reader. */
export interface TableFileKind {
  exts: string[]
  title: string
  write: (columns: RowsColumn[], rows: unknown[][]) => string | Promise<Buffer>
  read: (data: Buffer, name: string) => ImportedSheet[] | Promise<ImportedSheet[]>
}

/** The formats, each written and read in one place. */
export const TABLE_FILES: Record<TableFileFormat, TableFileKind> = {
  xlsx: { exts: ['xlsx', 'xlsm'], title: 'Excel', write: rowsXlsx, read: readXlsx },
  csv: { exts: ['csv', 'tsv', 'txt'], title: 'CSV / TSV', write: rowsCsv, read: readDelimited },
}

/** Files that look like tables but are not read — and what to do instead. */
export const UNREAD_TABLE_FILES: Record<string, string> = {
  xls: 'Старый формат Excel (.xls) не читается — откройте файл в Excel и сохраните как .xlsx',
  ods: 'Таблица LibreOffice (.ods) не читается — сохраните её как .xlsx или .csv',
  numbers: 'Таблица Numbers не читается — экспортируйте её в .xlsx или .csv',
}

/** The format of a file by its extension (lower-cased, without the dot). */
export function formatOfExt(ext: string): TableFileFormat | undefined {
  return (Object.keys(TABLE_FILES) as TableFileFormat[]).find((f) => TABLE_FILES[f].exts.includes(ext))
}
