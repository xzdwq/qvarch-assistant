import { computed, nextTick, onBeforeUnmount, ref, type Ref } from 'vue'
import { hitsItem, itemId, type TextItem } from '@shared/whiteboard'
import type { FrameScheduler } from './frames'
import { FONT, LINE, measureText } from './textMeasure'
import type { BoardDoc } from './useBoardDoc'
import type { BoardTools } from './useToolPrefs'
import type { BoardViewport } from './useBoardViewport'

/** A text being typed: where, what, how (an existing one has its id). */
export interface TextDraft {
  id?: string
  x: number
  y: number
  text: string
  size: number
  color: string
  rot?: number
}

/**
 * Typed text: a textarea over the sheet where the text goes (the canvas hides the one being typed). Leaving it
 * (Esc, Ctrl+Enter, a click elsewhere) commits it; emptied — the text goes.
 */
export function useTextEditor(o: {
  doc: BoardDoc
  viewport: BoardViewport
  tools: BoardTools
  frames: FrameScheduler
  sheet: Ref<HTMLElement | undefined>
  /** The textarea (a template ref of the board). */
  textEl: Ref<HTMLTextAreaElement | undefined>
}) {
  const { doc, viewport, frames, textEl } = o
  const editing = ref<TextDraft>()

  /** The textarea placed and sized over the text on the screen. */
  const editStyle = computed(() => {
    const e = editing.value
    const v = viewport.view.value
    if (!e || !v) return {}
    const m = measureText(e.text || ' ', e.size)
    return {
      left: `${(e.x - v.x) * v.z}px`,
      top: `${(e.y - v.y) * v.z}px`,
      width: `${(m.w + e.size) * v.z}px`,
      height: `${m.h * v.z + 4}px`,
      fontSize: `${e.size * v.z}px`,
      lineHeight: String(LINE),
      color: e.color,
      fontFamily: FONT,
      transform: e.rot ? `rotate(${e.rot}deg)` : undefined,
      transformOrigin: '0 0',
    }
  })

  /** Typing at a board point: a new text, or an existing one (its text selected). */
  async function start(x: number, y: number, item?: TextItem): Promise<void> {
    if (editing.value) finish()
    const tp = o.tools.tp.value
    editing.value = item ? { id: item.id, x: item.x, y: item.y, text: item.text, size: item.size, color: item.color, rot: item.rot } : { x, y, text: '', size: tp.textSize, color: tp.penColor }
    frames.schedule()
    await nextTick()
    textEl.value?.focus()
    if (item) textEl.value?.select()
  }

  /** The typed text committed (unchanged — nothing to commit; emptied — the text goes). */
  function finish(): void {
    const e = editing.value
    editing.value = undefined
    if (!e) return
    const text = e.text.replace(/\s+$/, '')
    const items = doc.board.value.items
    const was = e.id ? items.find((i) => i.id === e.id) : undefined
    if (!text) {
      // an emptied text goes
      if (was) doc.commit({ ...doc.board.value, items: items.filter((i) => i.id !== was.id) })
      else frames.schedule()
      return
    }
    const m = measureText(text, e.size)
    const item: TextItem = { id: e.id ?? itemId(), type: 'text', x: e.x, y: e.y, text, size: e.size, color: e.color, w: m.w, h: m.h, ...(e.rot ? { rot: e.rot } : {}) }
    if (was && was.type === 'text' && was.text === item.text && was.color === item.color && was.size === item.size) return void frames.schedule()
    doc.commit({ ...doc.board.value, items: was ? items.map((i) => (i.id === was.id ? item : i)) : [...items, item] })
  }

  /** Keys in the textarea stay there; Esc / Ctrl+Enter — done. */
  function onTextKey(e: KeyboardEvent): void {
    e.stopPropagation()
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault()
      finish()
      o.sheet.value?.focus({ preventScroll: true })
    }
  }

  /** The topmost text at a board point. */
  const textAt = (wx: number, wy: number) => [...doc.board.value.items].reverse().find((i): i is TextItem => i.type === 'text' && hitsItem(i, wx, wy, 2 / viewport.zoom()))

  /** The text being typed takes a colour / a size. */
  const recolor = (c: string) => editing.value && (editing.value.color = c)
  const resize = (size: number) => editing.value && (editing.value.size = size)

  onBeforeUnmount(() => editing.value && finish())

  return { editing, editStyle, start, finish, onTextKey, textAt, recolor, resize }
}
export type BoardTextEditor = ReturnType<typeof useTextEditor>
