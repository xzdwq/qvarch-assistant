import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ISLAND_WINDOW } from '@shared/island'
import type { IslandElements } from './islandElements'

/** Rect test with a margin around the element. */
function inside(el: HTMLElement | undefined, x: number, y: number, margin = 0): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin
}

/** A dropdown opened as a layer outside the shell (teleported to <body>): the pointer over it is "on the island". */
function overLayer(x: number, y: number): boolean {
  for (const el of document.body.children) {
    if (el.id === 'app' || !(el instanceof HTMLElement)) continue
    const r = el.getBoundingClientRect()
    if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  return false
}

const isTextField = (el: Element | null | EventTarget) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement

/**
 * The move handle is a native drag region: the page gets no mouse events over it. So the last point seen
 * before it (right next to it) means "on the handle" — such a hover never expands the pill.
 */
const HANDLE_ZONE = 14
/** The orb is a button: hovering it — or the strip above, right of and below it — must not expand the pill. */
const ORB_ZONE = 16
/** The window turns "solid" (not click-through) this far around the content. */
const SOLID_MARGIN = 16
const EXPAND_DELAY = 280
const COLLAPSE_DELAY = 450

export interface ExpandHooks {
  isNoteOpen: () => boolean
  isMenuOpen: () => boolean
  /** Collapsing drops what belonged to the panel (the highlighted block, the menu). */
  onCollapse: () => void
  /** Expanding reloads the settings. */
  onExpand: () => void
}

/**
 * Expanding and collapsing the island. Hover and click-through are decided here, from the island's own mouse
 * events (forwarded by Electron while the window is click-through): window-relative coordinates never drift
 * when the window moves between monitors with different scaling. Focus inside the panel, an open menu or the
 * pin keep it expanded under the user's hands.
 */
export function useIslandExpand(els: IslandElements, hooks: ExpandHooks) {
  const expanded = ref(false)
  const pinned = ref(false)
  const hovering = ref(false)
  /** Focus inside the panel / menu open — never collapse under the user's hands. */
  const engaged = ref(false)
  const panelH = ref(320)
  let expandTimer: ReturnType<typeof setTimeout> | undefined
  let collapseTimer: ReturnType<typeof setTimeout> | undefined

  function setExpanded(v: boolean): void {
    if (v === expanded.value) return
    expanded.value = v
    if (v) hooks.onExpand()
    else {
      hooks.onCollapse()
      window.qa.islandBlur()
    }
  }
  /** Drops a pending expansion (a click on the orb, a drag of the handle). */
  function cancelExpand(): void {
    clearTimeout(expandTimer)
    expandTimer = undefined
  }

  let last = { x: -1, y: -1 }
  const nearHandle = (x: number, y: number) => inside(els.pillHandle.value, x, y, HANDLE_ZONE)
  const nearOrb = (x: number, y: number) => inside(els.orbEl.value, x, y, ORB_ZONE)
  const noExpandAt = (x: number, y: number) => hooks.isNoteOpen() || nearHandle(x, y) || nearOrb(x, y)
  /** Hover comes with the cursor point: the move handle never triggers the expansion. */
  let suppressUntilLeave = false
  let solidNow = false
  function setSolid(solid: boolean): void {
    if (solid === solidNow) return
    solidNow = solid
    window.qa.islandSolid(solid)
  }

  function onDocMouse(e: MouseEvent): void {
    const r = els.shell.value?.getBoundingClientRect()
    if (!r) return
    const within = (m: number) => e.clientX >= r.left - m && e.clientX <= r.right + m && e.clientY >= r.top - m && e.clientY <= r.bottom + m
    // the window turns "solid" a little before the cursor reaches the content, so a quick click on a
    // button never races the click-through switch; the 16px ring is the only area that stops being see-through
    const layer = overLayer(e.clientX, e.clientY)
    setSolid(within(SOLID_MARGIN) || layer)
    last = { x: e.clientX, y: e.clientY }
    // leaving needs the cursor clearly outside — resting on the very edge must not collapse the island
    onHover(within(hovering.value ? 14 : 0) || layer, e.clientX, e.clientY)
  }
  function onDocLeave(e: MouseEvent): void {
    // switching the window between click-through and normal makes Chromium report a spurious "leave"
    // while the cursor is still on the content — only a real leave (outside the content) counts
    if (inside(els.shell.value, e.clientX, e.clientY, SOLID_MARGIN) || overLayer(e.clientX, e.clientY)) {
      // entering the drag region of the handle also looks like a "leave": stay compact
      if (!expanded.value && nearHandle(e.clientX, e.clientY)) cancelExpand()
      return
    }
    setSolid(false)
    onHover(false, -1, -1)
  }
  document.addEventListener('mousemove', onDocMouse)
  document.addEventListener('mouseleave', onDocLeave)

  const offHover = window.qa.onIslandHover((h) => {
    if (h.moved) {
      // a native drag has just ended: the window was solid all along; dragged the pill — stay compact
      solidNow = true
      cancelExpand()
      if (!expanded.value) suppressUntilLeave = true
    }
    if (h.leave) {
      solidNow = false
      onHover(false, -1, -1)
    }
  })

  function onHover(isInside: boolean, x: number, y: number): void {
    hovering.value = isInside
    if (isInside) {
      clearTimeout(collapseTimer)
      collapseTimer = undefined
      if (expanded.value) return
      if (suppressUntilLeave || noExpandAt(x, y)) cancelExpand()
      else if (!expandTimer) {
        expandTimer = setTimeout(() => {
          expandTimer = undefined
          // the cursor may have slid onto the handle meanwhile (no events there) — the last point tells
          if (hovering.value && !noExpandAt(last.x, last.y)) setExpanded(true)
        }, EXPAND_DELAY)
      }
      return
    }
    cancelExpand()
    suppressUntilLeave = false
    if (!collapseTimer)
      collapseTimer = setTimeout(() => {
        collapseTimer = undefined
        if (!engaged.value && !pinned.value && !hovering.value && !hooks.isMenuOpen()) setExpanded(false)
      }, COLLAPSE_DELAY)
  }

  // the hotkey opens the panel with the cut row focused
  const offHotkey = window.qa.onIslandHotkey(async () => {
    setExpanded(true)
    await nextTick()
    els.labelInput.value?.focus()
  })

  function onFocusIn(e: FocusEvent): void {
    engaged.value = isTextField(e.target)
  }
  function onFocusOut(): void {
    setTimeout(() => {
      engaged.value = !!els.panel.value?.contains(document.activeElement) && isTextField(document.activeElement)
      if (!engaged.value && !hovering.value && !pinned.value && !hooks.isMenuOpen()) setExpanded(false)
    }, 0)
  }
  function onWindowBlur(): void {
    engaged.value = false
    if (!hovering.value && !pinned.value) setExpanded(false)
  }
  window.addEventListener('blur', onWindowBlur)

  /** Collapses at once (Escape with nothing else to close). */
  function collapse(): void {
    engaged.value = false
    setExpanded(false)
  }

  async function togglePin(): Promise<void> {
    pinned.value = !pinned.value
    if (!pinned.value) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      engaged.value = false
      if (!hovering.value) setExpanded(false)
    }
    await window.qa.updateSettings({ island: { pinned: pinned.value } })
  }

  // the panel's height follows its content (up to the window)
  let ro: ResizeObserver | undefined
  watch(els.panel, (el) => {
    ro?.disconnect()
    if (!el) return
    ro = new ResizeObserver(() => (panelH.value = Math.min(Math.ceil(el.scrollHeight), ISLAND_WINDOW.height)))
    ro.observe(el)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onDocMouse)
    document.removeEventListener('mouseleave', onDocLeave)
    window.removeEventListener('blur', onWindowBlur)
    offHover()
    offHotkey()
    ro?.disconnect()
  })

  return { expanded, pinned, hovering, engaged, panelH, setExpanded, cancelExpand, collapse, togglePin, onFocusIn, onFocusOut }
}

export type IslandExpand = ReturnType<typeof useIslandExpand>
