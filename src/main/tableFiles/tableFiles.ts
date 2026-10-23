import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { TABLE_FILE_FORMATS, type ClipboardTable, type ImportedBook, type RowsExport, type TableFileApi } from '../../shared/tableData'
import { remoteError } from '../../shared/remoteError'
import { formatOfExt, TABLE_FILES, UNREAD_TABLE_FILES } from './formats'

/** A table file bigger than this is not read (a sheet for a note, not a data dump). */
const MAX_FILE_MB = 30

/** The window a dialog belongs to (the focused one). */
const ownerWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

/**
 * Table files: rows saved as Excel / CSV (a table of a note, a query's result, a loop's output) and a table file read
 * back as a grid — its sheets, its merged cells; the clipboard read for a paste asked from a menu.
 */
export class TableFiles implements TableFileApi {
  /** The rows written where the person says; the file's path, or nothing when cancelled. */
  async exportRows(x: RowsExport): Promise<string | undefined> {
    // (an unknown format from the page — CSV, its name and its content alike)
    const kind = Object.hasOwn(TABLE_FILES, x.format) ? TABLE_FILES[x.format] : TABLE_FILES.csv
    const ext = kind.exts[0]
    const name = `${String(x.name || 'Результат').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.${ext}`
    const r = await dialog.showSaveDialog(ownerWindow(), { defaultPath: join(app.getPath('downloads'), name), filters: [{ name: kind.title, extensions: [ext] }] })
    if (r.canceled || !r.filePath) return undefined
    writeFileSync(r.filePath, await kind.write(Array.isArray(x.columns) ? x.columns : [], Array.isArray(x.rows) ? x.rows : []))
    return r.filePath
  }

  /** A table file chosen and read (its sheets as grids); cancelled — undefined; unreadable — why. */
  async importFile(): Promise<ImportedBook | undefined> {
    const exts = TABLE_FILE_FORMATS.flatMap((f) => TABLE_FILES[f].exts)
    const r = await dialog.showOpenDialog(ownerWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Таблицы', extensions: [...exts, ...Object.keys(UNREAD_TABLE_FILES)] }, ...TABLE_FILE_FORMATS.map((f) => ({ name: TABLE_FILES[f].title, extensions: TABLE_FILES[f].exts }))],
    })
    const file = r.filePaths[0]
    if (r.canceled || !file) return undefined
    return this.readFile(file)
  }

  /** A table file read by its format (the extension decides). */
  async readFile(file: string): Promise<ImportedBook> {
    const ext = extname(file).slice(1).toLowerCase()
    const name = basename(file, extname(file))
    if (Object.hasOwn(UNREAD_TABLE_FILES, ext)) return { ok: false, error: UNREAD_TABLE_FILES[ext] }
    const format = formatOfExt(ext)
    if (!format) return { ok: false, error: `Файл .${ext} не таблица — подходят .xlsx и .csv` }
    try {
      if (statSync(file).size > MAX_FILE_MB * 1024 * 1024) return { ok: false, error: `Файл больше ${MAX_FILE_MB} МБ — для таблицы заметки это слишком много` }
      const sheets = await TABLE_FILES[format].read(readFileSync(file), name)
      return sheets.length ? { ok: true, name, sheets } : { ok: false, error: 'В файле нет листов с данными' }
    } catch (e) {
      return { ok: false, error: `Файл не прочитать: ${remoteError(e)}` }
    }
  }

  /** What the clipboard holds now: its HTML (a spreadsheet's table, merged cells) and its plain text. */
  async readClipboard(): Promise<ClipboardTable> {
    /** A type of the clipboard's item as text (none — undefined). */
    const asText = async (item: Electron.ClipboardItem | undefined, type: string) => {
      const data = item?.types.includes(type) ? await item.getType(type) : undefined
      return data instanceof Blob ? (await data.text()) || undefined : undefined
    }
    try {
      const item = (await clipboard.read())[0]
      return { html: await asText(item, 'text/html'), text: (await asText(item, 'text/plain')) ?? ((await clipboard.readText()) || undefined) }
    } catch {
      return {}
    }
  }
}
