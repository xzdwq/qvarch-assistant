import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { pressureCurve, type TabletPrefs, type TabletSample, type TabletState } from '@shared/tablet'

/**
 * The pen tablet run by Qvarch, as the renderer sees it: its state (settings, status, monitors) and the latest
 * pen sample. The pen itself arrives as the mouse; a drawing surface takes the pressure / tilt from here.
 */
const state = ref<TabletState>()
const sample = shallowRef<TabletSample>()
/** The express keys held now (bit 0 — K1) and the last raw keys report (for checking the format). */
const keysMask = ref(0)
const auxRaw = ref('')
let started = false

function ensure(): void {
  if (started) return
  started = true
  void window.qa.tabletState().then((s) => (state.value = s))
  window.qa.onTablet((m) => {
    switch (m.type) {
      case 'state':
        state.value = m.state
        return
      case 'keys':
        keysMask.value = m.mask
        return
      case 'aux':
        auxRaw.value = m.raw
        return
      case 'sample':
        sample.value = { ...m.s, at: performance.now() }
        return
      default: {
        const never: never = m
        return never
      }
    }
  })
}

export function useTablet() {
  ensure()
  return {
    state,
    sample,
    keysMask,
    auxRaw,
    async set(patch: Partial<TabletPrefs>): Promise<void> {
      state.value = await window.qa.tabletSet(patch)
    },
  }
}

/** Which board reported the tablet's "Qvarch canvas" last (several boards may be open in two panes). */
export const canvasOwner = { id: 0 }

/**
 * A drawing surface as the tablet's "Qvarch canvas": its on-screen area is reported when it appears, resizes and
 * when the pointer comes in (the last one wins); gone — no canvas (if it was the last one).
 * Returns `report` — to call when the surface becomes the active one (a press on it).
 */
export function useTabletCanvas(el: Ref<HTMLElement | undefined>): { report: () => void; isActive: () => boolean } {
  let my = 0
  let ro: ResizeObserver | undefined
  const report = (): void => {
    const e = el.value
    if (!e) return
    const r = e.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return
    const k = devicePixelRatio
    my = ++canvasOwner.id
    void window.qa.tabletCanvas({ x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k })
  }
  let watched: HTMLElement | undefined
  /** The surface's element may come and go (a tab of a dialog): follow it. */
  const follow = (): void => {
    const e = el.value
    if (e === watched) return
    if (watched) {
      ro?.unobserve(watched)
      watched.removeEventListener('pointerenter', report)
    }
    watched = e
    if (e) {
      ro?.observe(e)
      e.addEventListener('pointerenter', report)
      report()
    } else if (my === canvasOwner.id) void window.qa.tabletCanvas(null)
  }
  const stop = watch(el, follow, { flush: 'post' })
  onMounted(() => {
    ro = new ResizeObserver(report)
    window.addEventListener('resize', report)
    follow()
  })
  onBeforeUnmount(() => {
    stop()
    ro?.disconnect()
    watched?.removeEventListener('pointerenter', report)
    window.removeEventListener('resize', report)
    if (my === canvasOwner.id) void window.qa.tabletCanvas(null)
  })
  return { report, isActive: () => my !== 0 && my === canvasOwner.id }
}

/** While the component is mounted the helper streams the pen (it is quiet otherwise). */
export function useTabletLive(): void {
  ensure()
  onMounted(() => void window.qa.tabletLive(true))
  onBeforeUnmount(() => void window.qa.tabletLive(false))
}

/** The pen right now (fresh — under 120 ms), if Qvarch runs the tablet: drawing pressure 0…1 and tilt. */
export function penNow(): { pressure: number; tiltX: number; tiltY: number } | undefined {
  const s = sample.value
  const st = state.value
  if (!s || !st?.prefs.enabled || !s.in || performance.now() - (s.at ?? 0) > 120) return undefined
  return { pressure: pressureCurve(s.p, st.prefs), tiltX: st.prefs.tilt ? s.tx : 0, tiltY: st.prefs.tilt ? s.ty : 0 }
}
