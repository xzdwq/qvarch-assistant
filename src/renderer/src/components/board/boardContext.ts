import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { FrameScheduler } from './frames'
import type { PictureCache } from './paint/pictureCache'
import type { BoardScene } from './scene'
import type { BoardDoc } from './useBoardDoc'
import type { BoardImages } from './useBoardImages'
import type { SelectionActions } from './useSelectionActions'
import type { BoardViewport } from './useBoardViewport'
import type { FlashHint } from './useFlashHint'
import type { BoardTextEditor } from './useTextEditor'
import type { BoardTools } from './useToolPrefs'

/**
 * One board's parts, shared by its gestures, keys, clipboard and toolbar: the document, the view, the tools,
 * the text being typed, what is in progress (the scene) and the repaints.
 */
export interface BoardCtx {
  doc: BoardDoc
  viewport: BoardViewport
  tools: BoardTools
  text: BoardTextEditor
  scene: BoardScene
  frames: FrameScheduler
  hint: FlashHint
  pictures: PictureCache
  /** The sheet: the element the board is drawn in (it takes the keys). */
  sheet: Ref<HTMLElement | undefined>
  /** A pointer's / a drop's place on the sheet (screen px). */
  local: (e: { clientX: number; clientY: number }) => readonly [number, number]
  /** A problem told to the user. */
  warn: (e: unknown) => void
}

/** The board's parts as its toolbar and popovers see them: with the selection's and pictures' actions, the export. */
export interface BoardUi extends BoardCtx {
  actions: SelectionActions
  images: BoardImages
  exportPng: () => Promise<void>
}

const BOARD: InjectionKey<BoardUi> = Symbol('board')
/** The board's parts, for its child components. */
export const provideBoard = (b: BoardUi) => provide(BOARD, b)
export function useBoard(): BoardUi {
  const b = inject(BOARD)
  if (!b) throw new Error('useBoard() outside a BoardView')
  return b
}
