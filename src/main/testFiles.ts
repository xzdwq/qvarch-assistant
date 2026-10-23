import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { dialog, shell, type BrowserWindow } from 'electron'
import { RECORDED_SET, safeName, type TestFile, type TestFileSet, type TestFilesApi } from '../shared/testFiles'
import { makeFiles, type XSpec } from '../shared/excelGen'
import { fileBytes, makeValue, readTemplate } from './excelGen'

const META = '.meta.json'
type Meta = Record<string, { expect?: 'ok' | 'bad'; note?: string }>

/** The notebook's test files: vault/.files/<set>/<file>, each set's notes on its files in its .meta.json. */
export class TestFiles implements TestFilesApi {
  constructor(
    readonly root: string,
    private win: () => BrowserWindow | undefined,
  ) {}
  private dir(set: string): string {
    return join(this.root, safeName(set))
  }
  private readMeta(set: string): Meta {
    try {
      return JSON.parse(readFileSync(join(this.dir(set), META), 'utf8')) as Meta
    } catch {
      return {}
    }
  }
  private writeMeta(set: string, m: Meta): void {
    mkdirSync(this.dir(set), { recursive: true })
    writeFileSync(join(this.dir(set), META), JSON.stringify(m, null, 2), 'utf8')
  }
  /** A name free in the set: «имя.xlsx», else «имя (2).xlsx»… */
  private free(set: string, name: string): string {
    const n = safeName(name)
    const ext = extname(n)
    const base = n.slice(0, n.length - ext.length)
    let out = n
    for (let i = 2; existsSync(join(this.dir(set), out)); i++) out = `${base} (${i})${ext}`
    return out
  }
  /** The absolute path of «set/file» (for a run) — nothing outside the files' folder. */
  abs(rel: string): string {
    const parts = String(rel).split(/[\\/]/).filter(Boolean)
    if (parts.length !== 2 || parts.some((p) => p !== safeName(p))) throw new Error(`Файл «${rel}»: ожидается «Набор/файл»`)
    return join(this.root, parts[0], parts[1])
  }

  sets(): TestFileSet[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, count: readdirSync(join(this.root, d.name)).filter((f) => f !== META).length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }
  list(set: string): TestFile[] {
    const d = this.dir(set)
    if (!existsSync(d)) return []
    const meta = this.readMeta(set)
    return readdirSync(d, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name !== META)
      .map((f) => {
        const st = statSync(join(d, f.name))
        return { name: f.name, size: st.size, mtime: st.mtimeMs, ...(meta[f.name] ?? {}) }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }
  add(set: string, paths: string[]): string[] {
    mkdirSync(this.dir(set), { recursive: true })
    return paths.map((p) => {
      const name = this.free(set, basename(p))
      copyFileSync(p, join(this.dir(set), name))
      return name
    })
  }
  write(set: string, name: string, bytes: Uint8Array): string {
    mkdirSync(this.dir(set), { recursive: true })
    const n = this.free(set, name)
    writeFileSync(join(this.dir(set), n), bytes)
    return n
  }
  /** Written over (a generated file made again under its own name). */
  overwrite(set: string, name: string, bytes: Uint8Array): string {
    mkdirSync(this.dir(set), { recursive: true })
    const n = safeName(name)
    writeFileSync(join(this.dir(set), n), bytes)
    return n
  }
  remove(set: string, name: string): void {
    rmSync(join(this.dir(set), safeName(name)), { force: true })
    const m = this.readMeta(set)
    if (m[name]) {
      delete m[name]
      this.writeMeta(set, m)
    }
  }
  rename(set: string, name: string, to: string): string {
    const n = this.free(set, to)
    renameSync(join(this.dir(set), safeName(name)), join(this.dir(set), n))
    const m = this.readMeta(set)
    if (m[name]) {
      m[n] = m[name]
      delete m[name]
      this.writeMeta(set, m)
    }
    return n
  }
  meta(set: string, name: string, patch: { expect?: 'ok' | 'bad' | null; note?: string }): void {
    const m = this.readMeta(set)
    const cur = { ...(m[name] ?? {}) }
    if (patch.expect === null) delete cur.expect
    else if (patch.expect) cur.expect = patch.expect
    if (patch.note !== undefined) cur.note = patch.note || undefined
    m[name] = cur
    this.writeMeta(set, m)
  }
  createSet(name: string): string {
    const n = safeName(name)
    mkdirSync(this.dir(n), { recursive: true })
    return n
  }
  removeSet(name: string): void {
    rmSync(this.dir(name), { recursive: true, force: true })
  }
  async pick(set: string): Promise<string[]> {
    const w = this.win()
    const r = await (w ? dialog.showOpenDialog(w, { properties: ['openFile', 'multiSelections'], title: `Файлы в набор «${set}»` }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
    return r.canceled ? [] : this.add(set, r.filePaths)
  }
  async open(set: string, name: string): Promise<void> {
    const err = await shell.openPath(join(this.dir(set), safeName(name)))
    if (err) throw new Error(err)
  }
  reveal(set: string, name: string): void {
    shell.showItemInFolder(join(this.dir(set), safeName(name)))
  }
  /**
   * Excel / CSV files made by a spec into a set: the right one and one per fault (a file of the same name made again
   * is written over), each marked with what it should lead to and its note. Their names back.
   */
  async generate(set: string, spec: XSpec, defects: string[]): Promise<string[]> {
    const files = makeFiles(spec, defects, makeValue)
    const ext = spec.format === 'csv' ? '.csv' : '.xlsx'
    const m = this.readMeta(set)
    const names: string[] = []
    for (const f of files) {
      const n = this.overwrite(set, `${f.name}${ext}`, await fileBytes(f, spec.format))
      m[n] = { ...(f.expect ? { expect: f.expect } : {}), note: f.note }
      names.push(n)
    }
    this.writeMeta(set, m)
    return names
  }
  /** A template picked: its header and first rows (the generator's columns are guessed from them). */
  async template(): Promise<{ name: string; sheet: string; headers: string[]; samples: string[][] } | undefined> {
    const w = this.win()
    const opt = { properties: ['openFile' as const], title: 'Шаблон: файл с заголовками колонок', filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv', 'txt'] }] }
    const r = await (w ? dialog.showOpenDialog(w, opt) : dialog.showOpenDialog(opt))
    if (r.canceled || !r.filePaths[0]) return undefined
    return { name: basename(r.filePaths[0]).replace(/\.[^.]+$/, ''), ...(await readTemplate(r.filePaths[0])) }
  }
  /**
   * Files picked while recording: into «Записанные» (the same file picked again — the one already there, not a copy);
   * their «Записанные/имя» back.
   */
  recorded(paths: string[]): string[] {
    mkdirSync(this.dir(RECORDED_SET), { recursive: true })
    return paths.map((p) => {
      const name = safeName(basename(p))
      const at = join(this.dir(RECORDED_SET), name)
      try {
        if (existsSync(at) && statSync(at).size === statSync(p).size && readFileSync(at).equals(readFileSync(p))) return `${RECORDED_SET}/${name}`
      } catch {
        // compared as new
      }
      return `${RECORDED_SET}/${this.add(RECORDED_SET, [p])[0]}`
    })
  }
}
