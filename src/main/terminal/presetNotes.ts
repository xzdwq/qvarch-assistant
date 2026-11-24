import { filesOf, notesByRef, type VaultNode } from '../../shared/vault'

/** The notebook as the presets see it: its notes' tree and a note's path on disk (the Vault). */
export interface NotebookFiles {
  tree(): VaultNode[]
  absPath(rel: string): string
}

/**
 * `note('…')` in a preset: a notebook note's file on disk by its name or path (for a script to read). Missing or
 * ambiguous — a readable error.
 */
export class PresetNotes {
  constructor(private readonly notebook: () => NotebookFiles | undefined) {}

  /** A note's file by its name or path in the notebook. */
  note(ref: string): string {
    const nb = this.notebook()
    if (!nb) throw new Error('note(…): блокнот ещё не готов')
    const hits = notesByRef(String(ref), filesOf(nb.tree()))
    if (!hits.length) throw new Error(`note('${ref}'): заметки нет в блокноте`)
    if (hits.length > 1) throw new Error(`note('${ref}'): таких заметок несколько (${hits.join(', ')}) — укажите путь`)
    return nb.absPath(hits[0])
  }
}
