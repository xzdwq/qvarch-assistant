import { nextTick } from 'vue'
import type MdEditor from '@renderer/components/MdEditor.vue'
import type { Pane } from '@nb/workspace/paneLayout'

export type NoteEditor = InstanceType<typeof MdEditor>

/**
 * The notes' editors shown, by pane and note (`<pane id>:<path>`: a renamed note's new editor may come before the
 * old one is gone), and the title field of each pane.
 */
export class NoteEditors {
  private editors = new Map<string, NoteEditor>()
  private titles = new Map<string, HTMLInputElement>()

  static key = (p: Pane, path = p.active) => `${p.id}:${path}`

  /**
   * An editor mounted (el) or gone (null). Gone — the editors really unmounted are dropped after the update (the
   * key at hand may already be a renamed note's new one, and its new editor may have come first).
   */
  set(key: string, el: unknown): void {
    if (el) this.editors.set(key, el as NoteEditor)
    else void nextTick(() => this.dropUnmounted())
  }
  private dropUnmounted(): void {
    for (const [key, editor] of this.editors) if (editor.$.isUnmounted) this.editors.delete(key)
  }
  get(key: string): NoteEditor | undefined {
    return this.editors.get(key)
  }
  /** The editor of a pane's active note. */
  of(p: Pane | undefined): NoteEditor | undefined {
    return p?.active ? this.editors.get(NoteEditors.key(p)) : undefined
  }

  setTitle(paneId: string, el: HTMLInputElement): void {
    this.titles.set(paneId, el)
  }
  /** The pane's title field focused, its text chosen (a new note: its name typed first). */
  selectTitle(paneId: string): void {
    const el = this.titles.get(paneId)
    el?.focus()
    el?.select()
  }
  /** ↑ from the first line of the text — the cursor goes to the end of the title. */
  titleUp(p: Pane): void {
    const el = this.titles.get(p.id)
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }
}
