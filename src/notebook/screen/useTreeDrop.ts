import { ref } from 'vue'
import type { VaultNode } from '@shared/vault'
import { findNode } from '@shared/vaultTree'
import { tree } from '@nb/workspace/vaultTreeStore'
import { dirOf } from '@nb/domain/notePaths'

/** What a drop on the tree does: a node moved to a folder, a note linked with a board, .qvdoc files imported. */
export interface TreeDropActions {
  moveTo: (path: string, dir: string) => Promise<void>
  pair: (a: string, b?: string) => Promise<void>
  importDropped: (e: DragEvent, dir: string) => Promise<void>
}

/**
 * Drag & drop in the tree: a node onto a folder (or the empty space — the top level); a note onto a board (or
 * back) — links them; files from Explorer — imported into the folder under them.
 */
export function useTreeDrop(act: TreeDropActions) {
  const dragPath = ref<string>()
  /** The folder a drop would go into ('' — the top level). */
  const dropDir = ref<string>()
  /** The note / board a dragged one would be linked with. */
  const pairTarget = ref<string>()
  /** Files dragged from outside (not a node of the tree). */
  const fileDrag = (e: DragEvent) => !dragPath.value && !!e.dataTransfer?.types.includes('Files')
  const dirUnder = (n: VaultNode | undefined) => (n ? (n.dir ? n.path : dirOf(n.path)) : '')

  function onDragStart(n: VaultNode, e: DragEvent): void {
    dragPath.value = n.path
    e.dataTransfer?.setData('text/plain', n.path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(n: VaultNode | undefined, e?: DragEvent): void {
    // a file from outside: the folder it would go into lights up
    if (e && fileDrag(e)) {
      pairTarget.value = undefined
      dropDir.value = dirUnder(n)
      return
    }
    if (!dragPath.value) return
    const from = findNode(tree.value, dragPath.value)
    // a note over a board (or a board over a note): link them
    if (n && from && !n.dir && !from.dir && n.path !== from.path && !!n.board !== !!from.board) {
      pairTarget.value = n.path
      dropDir.value = undefined
      return
    }
    pairTarget.value = undefined
    dropDir.value = dirUnder(n)
  }
  async function onDrop(e?: DragEvent): Promise<void> {
    if (e && fileDrag(e)) {
      const dir = dropDir.value ?? ''
      dropDir.value = undefined
      return act.importDropped(e, dir)
    }
    const from = dragPath.value
    const to = dropDir.value
    const link = pairTarget.value
    dragPath.value = undefined
    dropDir.value = undefined
    pairTarget.value = undefined
    if (from && link) return void (await act.pair(from, link))
    if (from !== undefined && to !== undefined) await act.moveTo(from, to)
  }
  return { dragPath, dropDir, pairTarget, onDragStart, onDragOver, onDrop }
}
