import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { ISLAND_WINDOW, type Dock } from '@shared/island'
import { dockLength, islandSize, isSideDock, pillHeight, shellTopAt, type IslandDrawer } from '@shared/tracker/islandGeometry'
import { PILL_MIN, pillWidthFor } from '@shared/tracker/islandPill'
import type { IslandDay } from './useIslandDay'
import type { IslandElements } from './islandElements'
import type { IslandExpand } from './useIslandExpand'
import type { IslandSettings } from './useIslandSettings'

/** The pill's text cut off at this width when measuring (long app names ellipsize). */
const PART_MAX = 150
/** Room kept for the activity wave on the pill's first line. */
const WAVE_ROOM = 70

/**
 * Where and how big the island is: grows up or down, stuck to a screen edge (a slim pill flush with it), the pill's
 * width measured from its content, the shell's size and position; main is told the real rectangle (it docks by it).
 */
export function useIslandLayout(els: IslandElements, island: IslandSettings, day: IslandDay, expand: IslandExpand, drawer: Ref<IslandDrawer | undefined>) {
  const { ui, settings } = island
  const up = ref(false)
  /** Stuck to a screen edge: a slim pill flush with it (upright at a side edge); the panel opens from it. */
  const dock = ref<Dock>()
  /** At a side edge: the pill's centre from the window's top. */
  const dockOffset = ref(ISLAND_WINDOW.height / 2)
  function applyLayout(l: { up: boolean; dock?: Dock; offset?: number }): void {
    up.value = l.up
    dock.value = l.dock
    if (l.offset !== undefined) dockOffset.value = l.offset
  }
  void window.qa.getIslandLayout().then(applyLayout)
  const offLayout = window.qa.onIslandLayout(applyLayout)
  onBeforeUnmount(offLayout)

  const sideDock = computed(() => isSideDock(dock.value))
  const dockLen = computed(() => dockLength(ui.value.dock, !!day.nextMeeting.value))
  const pillH = computed(() => pillHeight(ui.value.pill))
  /** Opacity of the collapsed pill's background (settings) — chips and text stay solid; opaque while hovered or expanded. */
  const bgAlpha = computed(() => (expand.expanded.value || expand.hovering.value || drawer.value ? 1 : (settings.value?.island.opacity ?? 1)))

  /** The collapsed pill is as wide as its content (measured after each render), within PILL_MIN..PILL_MAX. */
  const pillW = ref(PILL_MIN)
  function measurePill(): void {
    const line = els.plineEl.value
    if (!line) return
    // the first line spans the pill (date and time sit at its right edge) — its natural width is the sum of its parts
    const parts = ([...line.children] as HTMLElement[]).filter((c) => !c.classList.contains('pwave') && !c.classList.contains('pfill'))
    const lineW = parts.reduce((a, c) => a + Math.max(c.offsetWidth, Math.min(c.scrollWidth, PART_MAX)), 0) + 6 * parts.length + 12 + (ui.value.pill.wave ? WAVE_ROOM : 0)
    const w = pillWidthFor(Math.max(lineW, els.chipsEl.value?.scrollWidth ?? 0, els.statsEl.value?.scrollWidth ?? 0))
    if (w !== pillW.value) pillW.value = w
  }
  onMounted(measurePill)

  const size = computed(() =>
    islandSize({ expanded: expand.expanded.value, panelH: expand.panelH.value, dock: dock.value, drawer: drawer.value, dockLen: dockLen.value, pillW: pillW.value, pillH: pillH.value }),
  )
  const shellTop = computed(() => shellTopAt(sideDock.value, dockOffset.value, size.value.h))

  // main docks the island by its real rectangle in the window
  let rectTimer: ReturnType<typeof setTimeout> | undefined
  function reportRect(): void {
    clearTimeout(rectTimer)
    rectTimer = setTimeout(() => {
      const r = els.shell.value?.getBoundingClientRect()
      if (r && r.width) window.qa.islandRect({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
    }, 480)
  }
  onMounted(() => {
    watch([size, dock, shellTop], reportRect)
    reportRect()
  })

  return { up, dock, pillH, bgAlpha, size, shellTop, measurePill }
}
