import { ref, shallowRef, watch } from 'vue'
import { applyBoardDiff, applyItems, diffBoards, diffItems, parseBoard, serializeBoard, type Board, type BoardBg, type BoardItem } from '@shared/whiteboard'
import { historyOf } from '../../lib/boardHistory'
import { rememberBg } from '../../lib/boardPrefs'
import type { FrameScheduler } from './frames'
import type { BoardScene } from './scene'

/** How many steps back undo keeps. */
const UNDO_DEPTH = 300

export interface BoardDocOptions {
  props: { path: string; text: string }
  frames: FrameScheduler
  scene: BoardScene
  /** The file's text changed: written back to it. */
  onChange: (text: string) => void
  /** The status line: what the board holds. */
  onInfo: (text: string) => void
  /** The file was changed elsewhere and taken here. */
  onReplaced: () => void
}

/**
 * The board and its file: every change committed (to undo / redo — the history lives outside, kept while the
 * board is left), the file's text written; a change made elsewhere taken (one's own undo still applies to one's own items).
 */
export function useBoardDoc(o: BoardDocOptions) {
  const board = shallowRef<Board>(parseBoard(o.props.text))
  let lastJson = o.props.text
  const hist = historyOf(o.props.path)
  /** The selected items' ids (the selection tool). */
  const sel = shallowRef<Set<string>>(new Set())
  const canUndo = ref(hist.undo.length > 0)
  const canRedo = ref(hist.redo.length > 0)

  watch(
    () => o.props.text,
    (t) => {
      if (t === lastJson) return
      // changed elsewhere (another pane, someone else on a shared board): taken; one's own undo stays (it changes
      // only one's own items), a gesture going on carries on over the new state
      const was = board.value
      const next = parseBoard(t)
      if (o.scene.preview) o.scene.preview = applyItems(next.items, diffItems(was.items, o.scene.preview))
      lastJson = t
      board.value = next
      o.onReplaced()
      o.frames.schedule()
    },
  )

  /** A new state of the board: shown, written to the file and (unless undoing) kept for undo. */
  function commit(next: Board, undoable = true): void {
    if (undoable) {
      hist.undo.push({ before: board.value, after: next })
      if (hist.undo.length > UNDO_DEPTH) hist.undo.shift()
      hist.redo.length = 0
    }
    board.value = next
    lastJson = serializeBoard(next)
    o.onChange(lastJson)
    o.frames.schedule()
  }

  watch(
    board,
    () => {
      canUndo.value = hist.undo.length > 0
      canRedo.value = hist.redo.length > 0
      // a selection keeps only what still exists
      if (sel.value.size) {
        const ids = new Set(board.value.items.map((i) => i.id))
        const kept = [...sel.value].filter((id) => ids.has(id))
        if (kept.length !== sel.value.size) sel.value = new Set(kept)
      }
      o.onInfo(countsLine(board.value.items))
    },
    { immediate: true },
  )

  /** A step taken back / again: only its items changed on the board as it is now. */
  function undo(): void {
    const step = hist.undo.pop()
    if (!step) return
    hist.redo.push(step)
    commit(applyBoardDiff(board.value, diffBoards(step.after, step.before)), false)
  }
  function redo(): void {
    const step = hist.redo.pop()
    if (!step) return
    hist.undo.push(step)
    commit(applyBoardDiff(board.value, diffBoards(step.before, step.after)), false)
  }
  function clearAll(): void {
    if (!board.value.items.length) return
    if (!confirm('Очистить всю доску? Отменить можно через Ctrl+Z.')) return
    commit({ ...board.value, items: [] })
  }

  // the board shown is the "last one": a new board takes its background
  watch(() => board.value.bg, (bg) => rememberBg(bg), { deep: true, immediate: true })
  function setBg(p: Partial<BoardBg>): void {
    commit({ ...board.value, bg: { ...board.value.bg, ...p } })
  }

  /** The items as shown now: being changed (a preview) or as they are. */
  const shown = (): BoardItem[] => o.scene.preview ?? board.value.items
  /** Items added on top (committed). */
  const addItems = (fresh: BoardItem[]) => commit({ ...board.value, items: [...board.value.items, ...fresh] })

  return { board, sel, canUndo, canRedo, commit, undo, redo, clearAll, setBg, shown, addItems }
}
export type BoardDoc = ReturnType<typeof useBoardDoc>

/** The status line: strokes, texts (and shapes), pictures. */
export function countsLine(items: BoardItem[]): string {
  const ink = items.filter((i) => i.type === 'ink').length
  const pics = items.filter((i) => i.type === 'image').length
  const text = items.length - ink - pics
  return `Штрихов: ${ink}${text ? ` · Текстов: ${text}` : ''}${pics ? ` · Изображений: ${pics}` : ''}`
}
