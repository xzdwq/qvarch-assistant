import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import { pressureCurve, type TabletPrefs, type TabletSample, type TabletState } from '@shared/tablet'
import { HOP_DWELL_MS, HOP_ENTRY } from '@shared/tabletHop'
import { TabletSurfaces, type PenNow } from './tabletSurfaces'

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

/** The pen over the surfaces: hovering / touching, while Qvarch maps it onto «Полотно Qvarch» and it is in range. */
function penOverSurfaces(): PenNow | undefined {
  const s = sample.value
  const st = state.value
  if (!s || !st?.prefs.enabled || st.prefs.target.kind !== 'canvas' || !s.in || performance.now() - (s.at ?? 0) > 200) return undefined
  return { hovering: !s.c, touching: s.c }
}
/** Every drawing surface on screen; the pen on one of them (see TabletSurfaces). */
const surfaces = new TabletSurfaces({ pen: penOverSurfaces, send: (rect) => void window.qa.tabletCanvas(rect), hopMs: () => state.value?.prefs.hopMs ?? HOP_DWELL_MS })
// clamped at an edge the pointer stands still — the pen's samples keep the hop going
watch(sample, () => surfaces.feed())

/**
 * A drawing surface as the tablet's «Полотно Qvarch»: its visible part is the pen's while it is the active one
 * (pressed / entered last, or the pen went over to it from another one's edge). Returns `report` — to call when it
 * is pressed; `isActive`; `hop` — the pen about to come over here (the edge it comes in at, how far the wait is).
 */
export function useTabletCanvas(el: Ref<HTMLElement | undefined>) {
  ensure()
  let my: number | undefined
  /** The surface's element may come and go (a tab of a dialog): follow it. */
  const follow = (e: HTMLElement | undefined, old: HTMLElement | undefined): void => {
    if (old) old.removeEventListener('pointerenter', report)
    if (my !== undefined) surfaces.remove(my)
    my = e ? surfaces.add(e) : undefined
    e?.addEventListener('pointerenter', report)
  }
  const report = (): void => {
    if (my !== undefined) surfaces.activate(my)
  }
  const stop = watch(el, follow, { flush: 'post' })
  onMounted(() => follow(el.value, undefined))
  onBeforeUnmount(() => {
    stop()
    follow(undefined, el.value)
  })
  const hop = computed(() => {
    const p = surfaces.pending.value
    return p && p.target === my ? { from: HOP_ENTRY[p.side], progress: p.progress } : undefined
  })
  return { report, isActive: () => my !== undefined && surfaces.isActive(my), hop }
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
