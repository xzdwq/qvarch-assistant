import { computed, ref, watch } from 'vue'
import { boardBox, centredOn, fitView, parseView, toScreen, toWorld, zoomAround, type BoardItem, type View } from '@shared/whiteboard'
import type { FrameScheduler } from './frames'

/** How long the view rests before it is remembered (ms). */
const SAVE_VIEW_MS = 400

/**
 * The board's view: pan & zoom over a W×H sheet (screen px). Each board remembers its view (a board inside a
 * note — `preview` — does not: it always shows the whole board; one drawn on inside a note — `inline` — keeps its
 * own, apart from the board's tab).
 */
export function useBoardViewport(props: { path: string; preview?: boolean; inline?: boolean }, items: () => BoardItem[], frames: FrameScheduler) {
  const W = ref(1)
  const H = ref(1)
  const view = ref<View>()
  const viewKey = () => `qa.board.view:${props.path}${props.inline ? ':note' : ''}`

  let viewTimer: ReturnType<typeof setTimeout> | undefined
  watch(view, (v) => {
    clearTimeout(viewTimer)
    if (props.preview) return frames.schedule()
    viewTimer = setTimeout(() => {
      try {
        if (v) localStorage.setItem(viewKey(), JSON.stringify(v))
      } catch {
        // fine
      }
    }, SAVE_VIEW_MS)
    frames.schedule()
  })

  /** The remembered view of this board (none — undefined). */
  function readView(): View | undefined {
    try {
      return parseView(localStorage.getItem(viewKey()))
    } catch {
      return undefined
    }
  }

  const zoomPct = computed(() => Math.round((view.value?.z ?? 1) * 100))
  const world = (sx: number, sy: number) => toWorld(view.value!, sx, sy)
  const screen = (wx: number, wy: number) => toScreen(view.value!, wx, wy)
  /** The view's zoom now (1 — no view yet). */
  const zoom = () => view.value?.z ?? 1

  /** Zoom by `f` around a screen point (the sheet's middle by default). */
  function zoomAt(f: number, sx = W.value / 2, sy = H.value / 2): void {
    if (view.value) view.value = zoomAround(view.value, f, sx, sy)
  }
  /** The whole board in view (an empty one — its origin in the middle). */
  function fit(): void {
    const box = boardBox(items())
    view.value = box ? fitView(box, W.value, H.value) : { x: -W.value / 2, y: -H.value / 2, z: 1 }
  }
  /** The view's centre to a board point. */
  const centreOn = (wx: number, wy: number) => view.value && (view.value = centredOn(wx, wy, view.value.z, W.value, H.value))
  /** The view's middle on the board. */
  const middle = (): readonly [number, number] => world(W.value / 2, H.value / 2)

  return { W, H, view, zoomPct, toWorld: world, toScreen: screen, zoom, zoomAt, fit, centreOn, middle, readView }
}
export type BoardViewport = ReturnType<typeof useBoardViewport>
