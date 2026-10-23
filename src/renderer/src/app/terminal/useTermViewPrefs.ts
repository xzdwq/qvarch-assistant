import { computed, ref, watch } from 'vue'

/** The side panel's tabs, in order. */
export const SIDE_TAB_IDS = ['presets', 'vars', 'watch'] as const
export type SideTab = (typeof SIDE_TAB_IDS)[number]
const isSideTab = (v: unknown): v is SideTab => (SIDE_TAB_IDS as readonly unknown[]).includes(v)

const PREFS_KEY = 'qa.term'
type StoredPrefs = { zoom?: number; side?: number; tab?: SideTab; hidden?: boolean }

/** The terminal section's own settings, remembered: the zoom, the side panel's width, tab and whether it is hidden. */
export function useTermViewPrefs() {
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as StoredPrefs
    } catch {
      return {}
    }
  })()
  const zoom = ref(saved.zoom ?? 100)
  const sideW = ref(saved.side ?? 260)
  const sideTab = ref<SideTab>(isSideTab(saved.tab) ? saved.tab : 'presets')
  /** The left panel hidden (like the notebook's): the terminals take the width. */
  const sideHidden = ref(!!saved.hidden)
  watch([zoom, sideW, sideTab, sideHidden], () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ zoom: zoom.value, side: sideW.value, tab: sideTab.value, hidden: sideHidden.value }))
    } catch {
      // fine
    }
  })
  const fontSize = computed(() => Math.round(13 * (zoom.value / 100) * 2) / 2)
  /** The side panel's width dragged by its edge. */
  function dragSide(e: PointerEvent): void {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = sideW.value
    const move = (ev: PointerEvent) => (sideW.value = Math.min(480, Math.max(200, w0 + ev.clientX - x0)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { zoom, sideW, sideTab, sideHidden, fontSize, dragSide }
}
