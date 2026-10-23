import { ref, shallowRef, watch } from 'vue'
import { parseBoard, serializeBoard, type Board, type BoardBg, type BoardItem } from '@shared/whiteboard'
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
 * board is left), the file's text written; a change made elsewhere taken (the history no longer applies).
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
      // changed outside (another pane, another editor): take it, the history no longer applies
      lastJson = t
      board.value = parseBoard(t)
      o.onReplaced()
      hist.undo.length = 0
      hist.redo.length = 0
      sel.value = new Set()
      o.frames.schedule()
    },
  )

  /** A new state of the board: shown, written to the file and (unless undoing) kept for undo. */
  function commit(next: Board, undoable = true): void {
    if (undoable) {
      hist.undo.push(board.value)
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

  function undo(): void {
    const prev = hist.undo.pop()
    if (!prev) return
    hist.redo.push(board.value)
    commit(prev, false)
  }
  function redo(): void {
    const next = hist.redo.pop()
    if (!next) return
    hist.undo.push(board.value)
    commit(next, false)
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
