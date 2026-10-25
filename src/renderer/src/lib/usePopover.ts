import { computed, inject, onBeforeUnmount, provide, ref, toValue, watch, type InjectionKey, type MaybeRefOrGetter, type Ref, type WritableComputedRef } from 'vue'
import { PopoverLayer, PopoverStack } from '@shared/popoverLayers'
import { beside, placeFloat, visibleRect } from './floating'

/** A point of the window a popover opens at (a right click). */
export interface PopoverPoint {
  x: number
  y: number
  /** What was clicked to open it (a chip): a press on it is not «outside» — its click may close it again. */
  from?: HTMLElement
}
/** What a popover opens from: an element (it stays beside it) or a point (it stands there until anything scrolls). */
export type PopoverAnchor = HTMLElement | PopoverPoint | null | undefined
/** Where it opens from, for its place: the anchor's box (a point's is empty) and its element (none for a point). */
export interface PopoverFrom {
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  el?: HTMLElement
}
/** Its place: the panel's style (fixed to the window), whether it opened upwards, the height it has room for. */
export interface Placed {
  style: Record<string, string>
  up?: boolean
  room?: number
}
/** How a popover is placed by what it opens from (`panel` — its element once shown: its size known). */
export type Placement = (from: PopoverFrom, panel: HTMLElement | undefined) => Placed

export interface PopoverOptions {
  /** its width, px (or by its anchor's element) — kept inside the window / the side panel it opens in */
  width?: number | ((el: HTMLElement) => number)
  /** its left edge at the anchor's left (else its right edge at the anchor's right) */
  alignLeft?: boolean
  /** room its own header / padding takes, px (subtracted from the height it may have) */
  chrome?: number
  /** its max height from the room there is (default — all of it); 'none' — not limited (a list inside it is) */
  maxHeight?: 'none' | ((room: number) => number)
  /** a place of its own (default: beside its element — placeFloat; at its point — inside the window) */
  place?: Placement
  /** Esc closes it (default); off — a field under it handles Esc itself (a field's suggestions), or — for now — a form opened from it */
  esc?: boolean | (() => boolean)
}

/** Beside its element (placeFloat): above or under it, wherever there is more room. */
export function floatPlace(el: HTMLElement, o: PopoverOptions): Placed {
  const f = placeFloat(el, typeof o.width === 'function' ? o.width(el) : (o.width ?? 220), o.alignLeft, o.chrome)
  const style = o.maxHeight === 'none' ? f.style : { ...f.style, maxHeight: `${o.maxHeight ? o.maxHeight(f.maxH) : f.maxH}px` }
  return { style, up: f.up, room: f.maxH }
}

/** Under its anchor (over it when there is no room under), its corner set by `beside`; the height — once it is shown. */
export function besidePlace(width: number, height: number, alignRight = false): Placement {
  return ({ rect }, panel) => {
    const p = beside(rect, width, panel?.offsetHeight ?? height, alignRight)
    return { style: { left: `${p.x}px`, top: `${p.y}px` } }
  }
}

/** At its point, kept inside the window (or `bounds`) once its size is known. */
export function pointPlace(margin = 4, size = { w: 200, h: 120 }, bounds?: () => { left: number; top: number; right: number; bottom: number } | undefined): Placement {
  return ({ rect }, panel) => {
    const b = bounds?.() ?? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    const w = panel?.offsetWidth ?? size.w
    const h = panel?.offsetHeight ?? size.h
    return { style: { left: `${Math.max(b.left + margin, Math.min(rect.left, b.right - w - margin))}px`, top: `${Math.max(b.top + margin, Math.min(rect.top, b.bottom - h - margin))}px` } }
  }
}

/** Exactly at its point (the point was already fitted into the window). */
export const atPoint: Placement = ({ rect }) => ({ style: { left: `${rect.left}px`, top: `${rect.top}px` } })

/** A popover whose state is what it shows (a menu's target…): open while there is one; closed — cleared. */
export function openWhile<T>(state: Ref<T | undefined>): WritableComputedRef<boolean> {
  return computed({
    get: () => state.value !== undefined,
    set: (on) => void (on || (state.value = undefined)),
  })
}

// ---------- the popovers open now: Esc closes the last one opened (and goes no further — not to a dialog behind it) ----------
interface OpenPopover {
  close: () => void
  esc: () => boolean
}
const opened = new PopoverStack<OpenPopover>()
function onEsc(e: KeyboardEvent): void {
  const top = opened.top()
  if (e.key !== 'Escape' || !top?.esc()) return
  e.stopPropagation()
  top.close()
}
function setOpened(p: OpenPopover, on: boolean): void {
  if (on) opened.push(p)
  else opened.remove(p)
  if (opened.size) window.addEventListener('keydown', onEsc, true)
  else window.removeEventListener('keydown', onEsc, true)
}

/**
 * Something open that is not a popover (a title edited in place): Esc closes it as the last thing opened, wherever
 * the focus is (a popover opened over it — that one first).
 */
export function useEscLayer(active: Ref<boolean>, close: () => void): void {
  const entry: OpenPopover = { close, esc: () => true }
  watch(active, (on) => setOpened(entry, on), { immediate: true })
  onBeforeUnmount(() => setOpened(entry, false))
}

/** The popover a component is inside of (its slot / panel): popovers opened in it count as part of it. */
const LAYER: InjectionKey<PopoverLayer<Node>> = Symbol('popover')

const isElement = (a: PopoverAnchor): a is HTMLElement => !!a && 'getBoundingClientRect' in a

/**
 * One popover's life: open or not; its place by what it opens from — beside an element and kept with it while open
 * (the element gone or scrolled out of sight — closed), or at a point (anything scrolled or the window resized —
 * closed: it stood by what has moved); closed by a press outside it, its element and the popovers opened inside it,
 * and by Esc (the last one opened only). `open` may be handed in (a v-model) or made here; `panel` — bind it to the
 * popover's element.
 */
export function usePopover(anchor: MaybeRefOrGetter<PopoverAnchor>, options: PopoverOptions = {}, open: Ref<boolean> = ref(false)) {
  const panel = ref<HTMLElement>()
  const style = ref<Record<string, string>>({ position: 'fixed', left: '-10000px', top: '0px' })
  /** it opened upwards (no room under its anchor) */
  const up = ref(false)
  /** the height it has room for, px */
  const room = ref(0)
  const close = () => void (open.value = false)
  const anchorNow = () => toValue(anchor) ?? undefined

  /** Placed by its anchor now. */
  function place(): void {
    const a = anchorNow()
    if (!a) return
    const el = isElement(a) ? a : undefined
    const rect = isElement(a) ? a.getBoundingClientRect() : { left: a.x, right: a.x, top: a.y, bottom: a.y, width: 0, height: 0 }
    const where = options.place ?? ((from: PopoverFrom, p?: HTMLElement) => (from.el ? floatPlace(from.el, options) : pointPlace()(from, p)))
    const p = where({ rect, el }, panel.value)
    style.value = p.style
    up.value = !!p.up
    room.value = p.room ?? 0
  }

  // kept with its element: every frame its place is looked at — moved, the popover placed again; gone — closed
  let raf = 0
  let last = ''
  function follow(): void {
    const el = anchorNow()
    // (a point: nothing to follow; no anchor yet — waited for)
    if (el && !isElement(el)) return
    if (el) {
      if (!el.isConnected || !visibleRect(el)) return close()
      const r = el.getBoundingClientRect()
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${window.innerWidth},${window.innerHeight}`
      if (key !== last) {
        last = key
        place()
      }
    }
    raf = requestAnimationFrame(follow)
  }

  const layer = new PopoverLayer<Node>((t) => !!panel.value?.contains(t), inject(LAYER, undefined))
  provide(LAYER, layer)
  const inside = (t: EventTarget | null) => {
    const a = anchorNow()
    return t instanceof Node && (!!(isElement(a) ? a.contains(t) : a?.from?.contains(t)) || layer.holds(t))
  }
  const onDown = (e: PointerEvent) => !inside(e.target) && close()
  // (at a point: what it stood by has moved — its own list scrolling is not that)
  const onScroll = (e: Event) => !isElement(anchorNow()) && !inside(e.target) && close()
  const onResize = () => !isElement(anchorNow()) && close()
  const self: OpenPopover = { close, esc: () => (typeof options.esc === 'function' ? options.esc() : options.esc !== false) }

  function setOpen(on: boolean): void {
    cancelAnimationFrame(raf)
    last = ''
    setOpened(self, on)
    if (on) {
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)
      // (placed at once — never shown a frame unplaced, at the window's corner)
      place()
      follow()
    } else {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }
  watch(open, setOpen, { immediate: true })
  // shown: its size is known now — placed again (a point's menu kept inside the window, the side with room taken)
  watch(panel, (p) => p && open.value && place())
  // another anchor while open (another button of the same picker, a new point): placed by it
  watch(
    () => anchorNow(),
    () => {
      last = ''
      if (open.value) place()
    },
  )
  onBeforeUnmount(() => {
    setOpen(false)
    layer.detach()
  })

  return {
    open,
    panel,
    /** for the panel's `:ref` */
    panelRef: (el: unknown) => void (panel.value = (el as HTMLElement | null) ?? undefined),
    style,
    up,
    room,
    place,
    close,
    toggle: () => (open.value = !open.value),
  }
}
