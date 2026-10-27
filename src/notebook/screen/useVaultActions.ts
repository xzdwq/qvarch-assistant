import { nextTick } from 'vue'
import { resolveWiki, type VaultNode } from '@shared/vault'
import { findNode } from '@shared/vaultTree'
import { serializeBoard } from '@shared/whiteboard'
import { freshBoard } from '@renderer/lib/boardPrefs'
import { remoteError } from '../../shared/remoteError'
import { forgetRuns, moveRuns } from '@nb/engine'
import { docs } from '@nb/workspace/noteDocs'
import { closeEverywhere, curPane, layout, openFile, swapTab } from '@nb/workspace/paneLayout'
import { remap } from '@nb/workspace/noteSync'
import { relinkAfterMove } from '@nb/workspace/wikiRelink'
import { askPlace } from '@nb/workspace/noteGoto'
import { files, loadTree, tree } from '@nb/workspace/vaultTreeStore'
import { dirOf, noteName } from '@nb/domain/notePaths'
import type { NoteEditors } from './noteEditors'
import type { TreeEditing } from './useTreeEditing'

/**
 * What is done to the vault's files from the notes screen: notes, boards and folders made, renamed, moved,
 * deleted (to the bin), a note linked with a board, marks set. Each reports what went wrong (`say`) and reads
 * the tree again.
 */
export function useVaultActions(say: (t: string) => void, editing: TreeEditing, editors: NoteEditors) {
  const { focus, targetDir, focusFollows, focusGone } = editing
  const ensureOpen = (dir: string) => dir && !layout.open.includes(dir) && layout.open.push(dir)
  /** Runs the action; its error said. */
  async function attempt(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      say(remoteError(e))
    }
  }

  /** A new note; like Obsidian: the title first, Enter — to the text. */
  const newNote = (dir = targetDir.value, pane?: number) =>
    attempt(async () => {
      const path = await window.qa.vaultCreate(dir, 'note')
      await loadTree()
      openFile(path, { pane })
      await nextTick()
      editors.selectTitle(curPane().id)
    })
  /** A new board (an endless sheet for schemes and notes) — a .qboard file in the folder. */
  const newBoard = (dir = targetDir.value, pane?: number) =>
    attempt(async () => {
      const path = await window.qa.vaultCreate(dir, 'board', undefined, serializeBoard(freshBoard()))
      await loadTree()
      openFile(path, { pane })
    })
  const newFolder = (dir = targetDir.value) =>
    attempt(async () => {
      const path = await window.qa.vaultCreate(dir, 'folder')
      await loadTree()
      ensureOpen(dir)
      focus.value = path
      void editing.startRename(path)
    })
  /** Renamed in place (the same folder); the open tabs, the runs and the chosen folder follow. */
  async function rename(path: string, name: string): Promise<void> {
    const clean = name.trim()
    const old = findNode(tree.value, path)?.name ?? noteName(path)
    if (!clean || clean === old) return
    await attempt(async () => {
      const before = files.value
      const to = await window.qa.vaultMove(path, dirOf(path), clean)
      remap(path, to)
      moveRuns(path, to)
      focusFollows(path, to)
      await loadTree()
      // the links to it follow its new name
      await relinkAfterMove(path, to, before)
    })
  }
  /** The tree's rename field closed: renamed (`apply`) or left as it was. */
  async function finishRename(apply: boolean): Promise<void> {
    const p = editing.renaming.value
    editing.renaming.value = undefined
    if (apply && p) await rename(p, editing.renameText.value)
  }
  async function moveTo(path: string, dir: string): Promise<void> {
    if (dirOf(path) === dir || path === dir) return
    await attempt(async () => {
      const before = files.value
      const to = await window.qa.vaultMove(path, dir)
      remap(path, to)
      moveRuns(path, to)
      focusFollows(path, to)
      ensureOpen(dir)
      await loadTree()
      await relinkAfterMove(path, to, before)
    })
  }
  async function remove(n: VaultNode): Promise<void> {
    if (!confirm(n.dir ? `Удалить папку «${n.name}» со всеми заметками? (в корзину)` : `Удалить заметку «${n.name}»? (в корзину)`)) return
    await attempt(async () => {
      closeEverywhere(n.path)
      await window.qa.vaultDelete(n.path)
      for (const k of [...docs.keys()]) if (k === n.path || k.startsWith(n.path + '/')) docs.delete(k)
      // its runs too (a new note of that name must not show them)
      forgetRuns(n.path)
      focusGone(n.path)
      await loadTree()
    })
  }
  /** A note linked with a board (b undefined — unlinked). */
  async function pair(a: string, b?: string): Promise<void> {
    await attempt(async () => {
      await window.qa.vaultPair(a, b)
      await loadTree()
      if (b) say(`Связано: «${noteName(a)}» и «${noteName(b)}»`)
    })
  }
  /** The other view of a linked file, in this pane (or in the other one: `aside`). */
  function showPair(pi: number, aside = false): void {
    const p = layout.panes[pi]
    const other = p?.active ? findNode(tree.value, p.active)?.pair : undefined
    if (!other) return
    if (!aside) return swapTab(pi, other)
    if (layout.panes.length > 1) openFile(other, { pane: pi === 0 ? 1 : 0 })
    else openFile(other, { newPane: true })
  }
  async function setColor(n: VaultNode, color?: string): Promise<void> {
    await window.qa.vaultSetColor(n.path, color)
    await loadTree()
  }
  async function setEmoji(n: VaultNode, emoji?: string): Promise<void> {
    await window.qa.vaultSetEmoji(n.path, emoji)
    await loadTree()
  }
  /** A wiki link followed; no such note — made (as Obsidian does). */
  function openWiki(target: string, newPane = false): void {
    const path = resolveWiki(target, files.value)
    // (`[[Заметка#место]]` — the note shown at that place)
    if (path) {
      askPlace(path, target.split('|')[0].split('#')[1])
      return openFile(path, { newPane })
    }
    void (async () => {
      const created = await window.qa.vaultCreate(targetDir.value, 'note', target.split('|')[0].split('/').pop())
      await loadTree()
      openFile(created, { newPane })
    })()
  }
  return { newNote, newBoard, newFolder, rename, finishRename, moveTo, remove, pair, showPair, setColor, setEmoji, openWiki }
}
