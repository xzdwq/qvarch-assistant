import { watch, type FSWatcher } from 'node:fs'
import { sep } from 'node:path'
import type { VaultFiles } from './vaultFiles'

/**
 * Changes made outside (another editor, Explorer): gathered for a moment, our own saves left out, then reported
 * (their paths). Dot folders and temp files are not watched.
 */
export class VaultWatcher {
  private watcher?: FSWatcher
  private pending = new Set<string>()
  private timer?: NodeJS.Timeout

  constructor(
    private files: VaultFiles,
    private onChange: (paths: string[]) => void,
  ) {}

  start(): void {
    try {
      this.watcher = watch(this.files.root, { recursive: true }, (_ev, name) => {
        if (!name) return
        const rel = String(name).split(sep).join('/')
        if (rel.split('/').some((p) => p.startsWith('.')) || rel.endsWith('.tmp')) return
        this.pending.add(rel)
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), 250)
      })
    } catch {
      // no watching on this system — the tree refreshes on our own actions only
    }
  }
  private flush(): void {
    const paths: string[] = []
    for (const rel of this.pending) {
      // our own save: same text on disk → not a change
      if (this.files.isOwnText(rel)) continue
      this.files.forget(rel)
      paths.push(rel)
    }
    this.pending.clear()
    if (paths.length) this.onChange(paths)
  }
  stop(): void {
    this.watcher?.close()
  }
}
