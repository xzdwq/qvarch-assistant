import { inject, provide, ref, watch, type InjectionKey } from 'vue'
import type { RequestTab } from '@shared/httpCollection'
import { useHttpCollection } from './useHttpCollection'
import { useHttpRunner } from './useHttpRunner'

const SIDE_KEY = 'qa.http.side'
const HIDDEN_KEY = 'qa.http.hidden'

/** The requests panel: its width (dragged, like the notebook's), hidden or not, and which of its drawers is open. */
function useHttpSide() {
  const sideW = ref(Math.min(560, Math.max(200, Number(localStorage.getItem(SIDE_KEY)) || 280)))
  /** The requests panel hidden (like the notebook's): the request takes the width. */
  const sideHidden = ref(localStorage.getItem(HIDDEN_KEY) === '1')
  watch(sideHidden, (v) => {
    try {
      localStorage.setItem(HIDDEN_KEY, v ? '1' : '0')
    } catch {
      // fine
    }
  })
  /** The variables drawer under the tree. */
  const varsOpen = ref(false)
  /** The «for all requests» drawer under the tree. */
  const setOpen = ref(false)
  function dragSide(e: PointerEvent): void {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = sideW.value
    const move = (ev: PointerEvent) => (sideW.value = Math.min(560, Math.max(200, w0 + ev.clientX - x0)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      try {
        localStorage.setItem(SIDE_KEY, String(sideW.value))
      } catch {
        // fine
      }
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { sideW, sideHidden, varsOpen, setOpen, dragSide }
}

/** Everything the HTTP section's parts share: the collection, the runs, the side panel, the open tab, the guide. */
function createHttpView() {
  const collection = useHttpCollection()
  const runner = useHttpRunner(collection)
  const side = useHttpSide()
  /** The request's open tab (kept while other nodes are selected). */
  const tab = ref<RequestTab>('params')
  const helpOpen = ref(false)
  return { collection, runner, side, tab, helpOpen }
}
export type HttpView = ReturnType<typeof createHttpView>
const HTTP_VIEW: InjectionKey<HttpView> = Symbol('httpView')

/** The HTTP section's shared state, made by the section and given to its parts. */
export function provideHttpView(): HttpView {
  const view = createHttpView()
  provide(HTTP_VIEW, view)
  return view
}
/** The HTTP section's shared state, inside one of its parts. */
export function useHttpView(): HttpView {
  const view = inject(HTTP_VIEW)
  if (!view) throw new Error('useHttpView: outside the HTTP section')
  return view
}
