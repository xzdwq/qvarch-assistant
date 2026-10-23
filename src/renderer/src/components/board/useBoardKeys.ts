import { onBeforeUnmount, onMounted } from 'vue'
import { ARROW_SHIFTS, isArrowKey } from '@shared/arrowKeys'
import type { BoardCtx } from './boardContext'
import { TOOL_BY_KEY } from './tools'
import type { SelectionActions } from './useSelectionActions'

/** One step of the keyboard zoom / sizing. */
const KEY_STEP = 1.2

/** A key's action; `needsSelection` — only with something selected (else the key is not taken). */
interface KeyAction {
  run: () => void
  needsSelection?: boolean
}

/** Is the user typing somewhere (the keys are not the board's then)? */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')

/**
 * The board's keys: on the sheet — tools (by the physical key), zoom, the selection (copy / paste / delete /
 * nudge), Space to pan; anywhere while the board is the active one — undo / redo (also from the tablet's keys).
 */
export function useBoardKeys(b: BoardCtx, actions: SelectionActions, isActiveBoard: () => boolean) {
  const { doc, viewport, tools, scene } = b
  const zoomIn = { run: () => viewport.zoomAt(KEY_STEP) }
  const zoomOut = { run: () => viewport.zoomAt(1 / KEY_STEP) }
  const fit = { run: () => viewport.fit() }
  /** Ctrl / ⌘ + a key (by KeyboardEvent.code). */
  const CTRL_KEYS: Record<string, KeyAction> = {
    Digit0: fit,
    Numpad0: fit,
    Equal: zoomIn,
    NumpadAdd: zoomIn,
    Minus: zoomOut,
    NumpadSubtract: zoomOut,
    KeyA: { run: actions.selectAll },
    KeyC: { run: actions.copySelected, needsSelection: true },
    KeyX: { run: () => (actions.copySelected(), actions.deleteSelected()), needsSelection: true },
    KeyV: { run: () => void actions.pasteAny() },
    KeyD: { run: actions.duplicate, needsSelection: true },
  }
  /** Keys on the selection (by KeyboardEvent.key); arrows nudge it (see onSelectionKey). */
  const SELECTION_KEYS: Record<string, (e: KeyboardEvent) => void> = {
    Delete: (e) => (e.preventDefault(), actions.deleteSelected()),
    Backspace: (e) => (e.preventDefault(), actions.deleteSelected()),
    Escape: () => actions.clearSelection(),
  }
  /** Ctrl / ⌘ + a key (by KeyboardEvent.code) anywhere while this board is the active one: undo / redo. */
  const HISTORY_KEYS: Record<string, (e: KeyboardEvent) => void> = {
    KeyZ: (e) => (e.shiftKey ? doc.redo() : doc.undo()),
    KeyY: () => doc.redo(),
  }
  /** Keys without Ctrl, by KeyboardEvent.key / .code, after the tools. */
  const PLAIN_KEYS: Record<string, () => void> = {
    '+': zoomIn.run,
    '=': zoomIn.run,
    '-': zoomOut.run,
    BracketLeft: () => tools.setSize(tools.size.value / KEY_STEP),
    BracketRight: () => tools.setSize(tools.size.value * KEY_STEP),
  }

  function onKey(e: KeyboardEvent): void {
    // Alt draws straight lines here — Windows must not take it for its window menu
    if (e.key === 'Alt') e.preventDefault()
    if (typing(e.target)) return
    if (e.ctrlKey || e.metaKey) return onCtrlKey(e)
    if (e.key === ' ') {
      scene.space.value = true
      e.preventDefault()
      return
    }
    if (doc.sel.value.size && onSelectionKey(e)) return
    const tool = TOOL_BY_KEY[e.code]
    if (tool) tools.tp.value.tool = tool
    else (PLAIN_KEYS[e.key] ?? PLAIN_KEYS[e.code])?.()
  }

  function onCtrlKey(e: KeyboardEvent): void {
    const a = CTRL_KEYS[e.code]
    if (!a || (a.needsSelection && !doc.sel.value.size)) return
    a.run()
    e.preventDefault()
    e.stopPropagation()
  }

  /** Delete, Esc, arrows with something selected; true — the key was taken. */
  function onSelectionKey(e: KeyboardEvent): boolean {
    if (Object.hasOwn(SELECTION_KEYS, e.key)) {
      SELECTION_KEYS[e.key](e)
      return true
    }
    if (!isArrowKey(e.key)) return false
    e.preventDefault()
    // Shift — by 10 screen px
    const step = (e.shiftKey ? 10 : 1) / viewport.zoom()
    const [dx, dy] = ARROW_SHIFTS[e.key]
    actions.nudge(dx * step, dy * step)
    return true
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') e.preventDefault()
    if (e.key === ' ') scene.space.value = false
  }

  /**
   * Ctrl+Z / Ctrl+Y (also from the tablet's keys) work while this is the active board, wherever the focus is —
   * except while typing somewhere. By the physical key: in the Russian layout Ctrl+Z gives "я".
   */
  function onWinKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return
    if (!isActiveBoard() || !b.sheet.value?.isConnected) return
    if (!Object.hasOwn(HISTORY_KEYS, e.code)) return
    HISTORY_KEYS[e.code](e)
    e.preventDefault()
    e.stopPropagation()
  }
  onMounted(() => window.addEventListener('keydown', onWinKey, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onWinKey, true))

  return { onKey, onKeyUp }
}
