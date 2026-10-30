import { app, BrowserWindow, dialog, shell } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { rowsCsv } from '../shared/tableData'
import { valueGrid } from '../shared/valueGrid'
import { valueFileName, valueFileStem, VALUE_FILE_FORMATS, type ValueFileApi, type ValueFileFormat, type ValueFileJob, type ValueFileSaved } from '../shared/valueFiles'
import { rowsXlsx } from './tableFiles/xlsx'

/** A cell as a file keeps it: a number / a text / a yes-no as it is, anything else — its JSON. */
const fileCell = (x: unknown) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : x)
/** How a value is written in each format. */
const WRITE: Record<ValueFileFormat, (v: unknown) => string | Promise<Buffer>> = {
  json: (v) => JSON.stringify(v, null, 2),
  txt: (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)),
  xlsx: (v) => {
    const g = valueGrid(v, fileCell)
    return rowsXlsx(g.head.map((name) => ({ name })), g.rows)
  },
  csv: (v) => {
    const g = valueGrid(v, fileCell)
    return rowsCsv(g.head.map((name) => ({ name })), g.rows)
  },
}

/** The window a dialog belongs to (the focused one). */
const ownerWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

/**
 * Values of notes kept as files (the «Сохранить в файл» block): a new file each run — only when the value changed since
 * the block's last file (their hashes), written whole or not at all (a temp file, then renamed); the block's older
 * files beyond its last N taken away — only its own (the document's and the variable's names start them).
 */
export class ValueFiles implements ValueFileApi {
  async save(job: ValueFileJob): Promise<ValueFileSaved> {
    const format: ValueFileFormat = (VALUE_FILE_FORMATS as readonly string[]).includes(job.format) ? job.format : 'json'
    // (the format and the mark count too: the same rows as CSV now, or whole after a partial file — a new file)
    const hash = createHash('sha256').update(`${format}|${job.partial ? 'p' : ''}|`).update(JSON.stringify(job.value) ?? '').digest('hex').slice(0, 32)
    if (job.lastHash === hash) return { hash, unchanged: true }
    const dir = await this.dirOf(job.dir)
    mkdirSync(dir, { recursive: true })
    const file = this.freeName(dir, valueFileName(job.note, job.name, new Date(), format, job.partial))
    const data = await WRITE[format](job.value)
    const tmp = `${file}.part`
    writeFileSync(tmp, data)
    renameSync(tmp, file)
    const removed = job.files ? this.keepLast(dir, valueFileStem(job.note, job.name), job.files) : 0
    return { file, hash, ...(removed ? { removed } : {}) }
  }
  async defaultDir(): Promise<string> {
    return join(app.getPath('documents'), 'Qvarch', 'exports')
  }
  async open(file: string): Promise<void> {
    if (!existsSync(file)) throw new Error(`Файла нет: ${file}`)
    const err = await shell.openPath(file)
    if (err) throw new Error(err)
  }
  async reveal(path: string): Promise<void> {
    const p = path || (await this.defaultDir())
    if (existsSync(p) && statSync(p).isFile()) return shell.showItemInFolder(p)
    mkdirSync(p, { recursive: true })
    await shell.openPath(p)
  }
  async pickDir(): Promise<string | undefined> {
    const r = await dialog.showOpenDialog(ownerWindow(), { properties: ['openDirectory', 'createDirectory'], defaultPath: await this.defaultDir() })
    return r.canceled ? undefined : r.filePaths[0]
  }

  /** A block's folder: its own (an absolute path), else the default one. */
  private async dirOf(dir: string | undefined): Promise<string> {
    const d = dir?.trim()
    if (d && !isAbsolute(d)) throw new Error(`Папка «${d}» — нужен полный путь (C:\\…), или оставьте пусто: ${await this.defaultDir()}`)
    return d || this.defaultDir()
  }
  /** A name not taken in the folder (taken in the same second — « (2)», « (3)»…). */
  private freeName(dir: string, name: string): string {
    const dot = name.lastIndexOf('.')
    for (let n = 1; ; n++) {
      const p = join(dir, n === 1 ? name : `${name.slice(0, dot)} (${n})${name.slice(dot)}`)
      if (!existsSync(p)) return p
    }
  }
  /** The block's files (the stem starts them) beyond the newest `keep` taken away; how many. */
  private keepLast(dir: string, stem: string, keep: number): number {
    const low = stem.toLowerCase()
    const mine = readdirSync(dir)
      .filter((n) => n.toLowerCase().startsWith(low) && !n.endsWith('.part'))
      .map((n) => ({ p: join(dir, n), t: statSync(join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    let removed = 0
    for (const f of mine.slice(keep))
      try {
        rmSync(f.p, { force: true })
        removed++
      } catch {
        // open in Excel — the next run tries again
      }
    return removed
  }
}
