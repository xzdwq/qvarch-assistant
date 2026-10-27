import { computed, nextTick, ref } from 'vue'
import { findNode } from '@shared/vaultTree'
import { tree } from '@nb/workspace/vaultTreeStore'
import { dirOf, noteName } from '@nb/domain/notePaths'

/**
 * The tree's own state: its focus (the folder or the file chosen in it last — not the note open in a pane) and the
 * node being renamed in place. New notes, boards and folders go where the focus is: into a folder, beside a file; no
 * focus (the empty space clicked) — the top.
 */
export function useTreeEditing() {
  /** The node chosen in the tree (none — nothing: the top). */
  const focus = ref<string>()
  const targetDir = computed(() => {
    const f = focus.value
    if (!f) return ''
    const n = findNode(tree.value, f)
    return n ? (n.dir ? f : dirOf(f)) : ''
  })
  /** A node moved or renamed: the focus follows it (on it or inside it). */
  function focusFollows(from: string, to: string): void {
    const f = focus.value
    if (f === from) focus.value = to
    else if (f?.startsWith(`${from}/`)) focus.value = to + f.slice(from.length)
  }
  /** A node deleted: the focus on it or inside it goes. */
  function focusGone(path: string): void {
    if (focus.value === path || focus.value?.startsWith(`${path}/`)) focus.value = undefined
  }

  const renaming = ref<string>()
  const renameText = ref('')
  /** The rename field (one at a time), set by the tree. */
  let renameInput: HTMLInputElement | null = null
  const setRenameInput = (el: unknown) => (renameInput = (el as HTMLInputElement | null) ?? null)
  /** A node's name as a field in its row, chosen whole. */
  async function startRename(path: string): Promise<void> {
    renaming.value = path
    renameText.value = findNode(tree.value, path)?.name ?? noteName(path)
    await nextTick()
    renameInput?.focus()
    renameInput?.select()
  }
  return { focus, targetDir, focusFollows, focusGone, renaming, renameText, setRenameInput, startRename }
}
export type TreeEditing = ReturnType<typeof useTreeEditing>
