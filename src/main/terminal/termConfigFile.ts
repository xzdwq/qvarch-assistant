import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TermConfig } from '../../shared/terminal'

/** The terminal's settings file (`terminal.json`): presets, variables, reactions, the last folder, the profile switch. */
export class TermConfigFile {
  private readonly file: string

  constructor(root: string) {
    this.file = join(root, 'terminal.json')
  }

  /** The settings as kept (missing lists — the examples); the first start writes the examples. */
  read(): TermConfig {
    try {
      const c = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<TermConfig>
      return {
        presets: Array.isArray(c.presets) ? c.presets : [],
        vars: Array.isArray(c.vars) ? c.vars : [],
        watches: Array.isArray(c.watches) ? c.watches : [],
        lastCwd: c.lastCwd,
        profile: c.profile ?? true,
      }
    } catch {
      // the first start: the examples
      const c: TermConfig = { presets: [], vars: [], watches: [], profile: true }
      this.write(c)
      return c
    }
  }
  /** Written to a side file first, then renamed over (never half a file). */
  write(c: TermConfig): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(c, null, 2))
    renameSync(tmp, this.file)
  }
}
