import { readJsonFile, writeJsonAtomic } from '../fsAtomic'
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
    // (a broken file is set aside first — the new one never replaces the presets it had)
    const c = readJsonFile<Partial<TermConfig>>(this.file)
    if (!c) {
      // the first start: the examples
      const fresh: TermConfig = { presets: [], vars: [], watches: [], profile: true }
      this.write(fresh)
      return fresh
    }
    return {
      presets: Array.isArray(c.presets) ? c.presets : [],
      vars: Array.isArray(c.vars) ? c.vars : [],
      watches: Array.isArray(c.watches) ? c.watches : [],
      lastCwd: c.lastCwd,
      profile: c.profile ?? true,
    }
  }
  /** Written whole or not at all. */
  write(c: TermConfig): void {
    writeJsonAtomic(this.file, c, 2)
  }
}
