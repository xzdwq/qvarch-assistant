import { ref, type Ref } from 'vue'
import type { VaultNode } from '@shared/vault'

/**
 * The tree's right-click menu (on a node, or on the empty space — the top level) and the whole emoji list opened
 * from it: their state (each is a popover at the click — TreeMenu, the emoji list in NotebookView).
 */
export function useTreeMenu(folder: Ref<string | undefined>) {
  const treeMenu = ref<{ x: number; y: number; node?: VaultNode }>()
  function openTreeMenu(e: MouseEvent, node?: VaultNode): void {
    treeMenu.value = { x: Math.min(e.clientX, window.innerWidth - 310), y: Math.min(e.clientY, window.innerHeight - 300), node }
    if (node?.dir) folder.value = node.path
  }
  /** The menu closes first — the action gets the node it was opened on. */
  function runOnNode(fn: (n?: VaultNode) => unknown): void {
    const n = treeMenu.value?.node
    treeMenu.value = undefined
    void fn(n)
  }

  /** The whole emoji list for a node (its place: where its menu was). */
  const emojiFor = ref<{ node: VaultNode; x: number; y: number }>()
  function moreEmoji(): void {
    const c = treeMenu.value
    if (!c?.node) return
    emojiFor.value = { node: c.node, x: Math.min(c.x, window.innerWidth - 360), y: Math.min(c.y, window.innerHeight - 340) }
    treeMenu.value = undefined
  }
  return { treeMenu, openTreeMenu, runOnNode, emojiFor, moreEmoji }
}
