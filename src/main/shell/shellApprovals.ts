import { join } from 'node:path'
import { readJsonFile, writeJsonQuietly } from '../fsAtomic'

/** At most this many approvals are kept (the oldest go). */
const MAX = 5000

/**
 * The shell scripts the person approved, by fingerprint (shared/shell/trust.ts) in data/shell-approvals.json: one
 * of them runs without asking; a changed script has another fingerprint — asked again.
 */
export class ShellApprovals {
  private readonly file: string
  private list: string[]

  constructor(root: string) {
    this.file = join(root, 'shell-approvals.json')
    const raw = readJsonFile<{ approved?: unknown }>(this.file)?.approved
    this.list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  }
  has(fingerprint: string): boolean {
    return this.list.includes(fingerprint)
  }
  add(fingerprint: string): void {
    if (!fingerprint || this.has(fingerprint)) return
    this.list = [...this.list, fingerprint].slice(-MAX)
    writeJsonQuietly(this.file, { approved: this.list })
  }
}
