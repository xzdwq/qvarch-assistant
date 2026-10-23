import { computed, nextTick, ref } from 'vue'
import { findNode } from '@shared/vaultTree'
import { curPane } from '@nb/workspace/paneLayout'
import { tree } from '@nb/workspace/vaultTreeStore'
import { dirOf, noteName } from '@nb/domain/notePaths'

/**
 * The tree's own state: the folder new notes go to (the one clicked last, else the active note's) and the node
 * being renamed in place.
 */
export function useTreeEditing() {
  const folder = ref<string>()
  const targetDir = computed(() => folder.value ?? dirOf(curPane()?.active ?? ''))

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
  return { folder, targetDir, renaming, renameText, setRenameInput, startRename }
}
export type TreeEditing = ReturnType<typeof useTreeEditing>
