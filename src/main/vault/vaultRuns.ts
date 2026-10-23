import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VaultFiles } from './vaultFiles'

/**
 * The runs of a runnable note (its context, its answers) — vault/.runs/<note>.json; a block's files of its last run
 * (screenshots, the trace…) — vault/.runs/<note>/<block>/. They go with their note / folder.
 */
export class VaultRuns {
  constructor(private files: VaultFiles) {}

  /** The folder all the runs' files are under (the trace viewer gives nothing else). */
  get root(): string {
    return join(this.files.root, '.runs')
  }
  private runFile(rel: string): string {
    this.files.abs(rel)
    return join(this.root, `${rel}.json`)
  }
  read(rel: string): string | undefined {
    const f = this.runFile(rel)
    try {
      return existsSync(f) ? readFileSync(f, 'utf8') : undefined
    } catch {
      return undefined
    }
  }
  write(rel: string, json: string): void {
    if (json.length > 16 * 1024 * 1024) throw new Error('Результаты больше 16 МБ — не сохраняются')
    const f = this.runFile(rel)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(`${f}.tmp`, json)
    renameSync(`${f}.tmp`, f)
  }
  /** A block's files of its last run: vault/.runs/<note>/<block>/ (on disk). */
  dir(rel: string, key: string): string {
    this.files.abs(rel)
    const safe = String(key).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'block'
    return join(this.root, rel, safe)
  }
  /** The runs follow their note / folder renamed or moved (`to` undefined — deleted: they go). */
  remap(from: string, to?: string): void {
    const rf = join(this.root, from)
    for (const [p, ext] of [[`${rf}.json`, '.json'], [rf, '']] as const) {
      if (!existsSync(p)) continue
      try {
        if (to === undefined) rmSync(p, { recursive: true, force: true })
        else {
          const t = join(this.root, to) + ext
          mkdirSync(dirname(t), { recursive: true })
          renameSync(p, t)
        }
      } catch {
        // a run kept or lost — the note itself is what matters
      }
    }
  }
}
