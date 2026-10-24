import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The log's size before it is put aside (one old one kept). */
const LOG_MAX = 1024 * 1024

/**
 * The shared notes' journal on this computer (`data/shared.log`): what was asked of the server for their files and
 * what came of it — to see where a picture got stuck when it does not show. No secrets in it: paths and statuses.
 */
export class SharedLog {
  private readonly file: string
  constructor(root: string) {
    this.file = join(root, 'shared.log')
  }
  write(line: string): void {
    try {
      if (existsSync(this.file) && statSync(this.file).size > LOG_MAX) renameSync(this.file, `${this.file}.1`)
      appendFileSync(this.file, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // a journal that cannot be written — nothing to do about it
    }
  }
}
