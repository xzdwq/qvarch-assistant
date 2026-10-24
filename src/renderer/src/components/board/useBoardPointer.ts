import { computed, onBeforeUnmount, type Ref } from 'vue'
import type { BoardCtx } from './boardContext'
import { commitPreview, startPan, type Gesture, type PointerAt } from './gestures/gesture'

/** How fast the wheel sizes a tool (per notch) and zooms (per wheel unit, with Ctrl). */
const WHEEL_SIZE_STEP = 1.12
const WHEEL_ZOOM = 0.0015
/** How long the wheel's size hint stays (ms). */
const SIZE_HINT_MS = 900

/**
 * The pointer on the sheet: a press starts the current tool's gesture (the middle / right button, Space or the
 * hand — the view pans), moves follow it, the release commits it. The wheel sizes the tool (Ctrl — zooms,
 * Shift / Alt — pans); `pageWheel` (a board inside a note) — the plain wheel is the page's: it scrolls the note.
 */
export function useBoardPointer(b: BoardCtx, liveCanvas: Ref<HTMLCanvasElement | undefined>, reportCanvas: () => void, opts: { pageWheel?: boolean } = {}) {
  const { scene, viewport, tools } = b
  let gesture: Gesture | undefined

  /** The pointer's place on the sheet and the board. */
  function pointerAt(e: PointerEvent): PointerAt {
    const [sx, sy] = b.local(e)
    const [wx, wy] = viewport.toWorld(sx, sy)
    return { sx, sy, wx, wy }
  }

  function onDown(e: PointerEvent): void {
    // no focus jump to the sheet by the browser (it would take the focus from a text just opened)
    e.preventDefault()
    if (b.text.editing.value) b.text.finish()
    b.sheet.value?.focus({ preventScroll: true })
    reportCanvas()
    if (!viewport.view.value) return
    liveCanvas.value?.setPointerCapture(e.pointerId)
    const at = pointerAt(e)
    const spec = tools.spec.value
    if (e.button === 1 || e.button === 2 || scene.space.value || spec.pans) gesture = startPan(b, at)
    else if (e.button === 0) gesture = spec.start?.(b, at, e)
  }

  function onMove(e: PointerEvent): void {
    const [sx, sy] = b.local(e)
    scene.hover = [sx, sy]
    if (gesture) return gesture.move(e, pointerAt(e))
    tools.spec.value.hover?.(b, pointerAt(e))
    b.frames.paintLive()
  }

  function onUp(): void {
    const g = gesture
    gesture = undefined
    scene.panning.value = false
    scene.frameRect = undefined
    scene.turning = undefined
    if (g) g.up()
    else commitPreview(b)
  }

  function onLeave(): void {
    scene.hover = undefined
    b.frames.paintLive()
  }

  function onWheel(e: WheelEvent): void {
    if (opts.pageWheel && !(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return
    e.preventDefault()
    const v = viewport.view.value
    if (!v || gesture) return
    if (e.ctrlKey || e.metaKey) {
      const [sx, sy] = b.local(e)
      viewport.zoomAt(Math.exp(-e.deltaY * WHEEL_ZOOM), sx, sy)
      return
    }
    // the wheel alone sizes the tool (the circle at the pointer shows it); Shift / Alt (or the hand, the selection) — moves
    const sized = tools.sized.value
    if (!e.shiftKey && !e.altKey && sized) {
      tools.setSize(tools.size.value * (e.deltaY < 0 ? WHEEL_SIZE_STEP : 1 / WHEEL_SIZE_STEP))
      if (sized.key === 'textSize') b.text.resize(tools.size.value)
      b.hint.flash(tools.spec.value.sizeLabel?.(tools.size.value) ?? '', SIZE_HINT_MS)
      b.frames.paintLive()
      return
    }
    const dx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX
    const dy = e.shiftKey ? 0 : e.deltaY
    viewport.view.value = { x: v.x + dx / v.z, y: v.y + dy / v.z, z: v.z }
  }

  /** The sheet's cursor: dragging the view, the hand / Space, else the tool's own. */
  const cursor = computed(() => {
    if (scene.panning.value) return 'grabbing'
    if (scene.space.value || tools.spec.value.pans) return 'grab'
    return tools.spec.value.cursor(scene)
  })

  onBeforeUnmount(() => gesture?.dispose?.())

  return { onDown, onMove, onUp, onLeave, onWheel, cursor }
}
