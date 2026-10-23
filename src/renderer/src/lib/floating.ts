/**
 * Where a dropdown opens: it floats over everything (teleported to <body>, fixed to the window), towards the
 * side with more room — no panel, scroll box or card clips it. In the island it goes out of the island's shell
 * as a layer (the island keeps its size; the island counts the layers of <body> as its own for clicks).
 * Only the geometry: a popover's life (open, kept by its anchor, closed) is usePopover's.
 */
export interface Float {
  teleport: boolean
  up: boolean
  maxH: number
  style: Record<string, string>
}

/** The part of an element one can see: the window's, cut by every scrolling box around it (none — undefined). */
export function visibleRect(el: Element): { left: number; top: number; right: number; bottom: number } | undefined {
  const r = el.getBoundingClientRect()
  let box = { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(window.innerWidth, r.right), bottom: Math.min(window.innerHeight, r.bottom) }
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (!/(auto|scroll|hidden)/.test(s.overflowX + s.overflowY)) continue
    const q = p.getBoundingClientRect()
    box = { left: Math.max(box.left, q.left), top: Math.max(box.top, q.top), right: Math.min(box.right, q.right), bottom: Math.min(box.bottom, q.bottom) }
  }
  return box.right > box.left && box.bottom > box.top ? box : undefined
}

/** A popover's corner beside a rect: under it (over it when there is no room under), inside the window. */
export function beside(r: { left: number; right: number; top: number; bottom: number }, w: number, h: number, alignRight = false): { x: number; y: number } {
  const x = Math.max(8, Math.min(alignRight ? r.right - w : r.left, window.innerWidth - w - 8))
  const under = window.innerHeight - r.bottom - 8 >= h || r.top - 8 < h
  return { x, y: under ? Math.min(r.bottom + 4, Math.max(8, window.innerHeight - h - 8)) : Math.max(8, r.top - h - 4) }
}

export function placeFloat(root: HTMLElement, width: number, alignLeft = false, chrome = 48): Float {
  const btn = root.getBoundingClientRect()
  const above = btn.top - 8
  const below = window.innerHeight - btn.bottom - 8
  const up = above > below
  // a button in a side panel beside a page (its native view lies over everything): the popover kept inside the panel —
  // over the page it would hide under it
  const bound = root.closest('.hpanel, [data-float-bound]')?.getBoundingClientRect()
  const lo = bound ? Math.max(8, bound.left + 4) : 8
  const hi = bound ? Math.min(window.innerWidth - 8, bound.right - 4) : window.innerWidth - 8
  const w = Math.min(width, hi - lo)
  const left = Math.max(lo, Math.min(hi - w, alignLeft ? btn.left : btn.right - w))
  return {
    teleport: true,
    up,
    maxH: Math.max(120, Math.min(420, (up ? above : below) - chrome)),
    style: {
      position: 'fixed',
      left: `${left}px`,
      right: 'auto',
      width: `${w}px`,
      ...(up ? { bottom: `${window.innerHeight - btn.top + 4}px`, top: 'auto' } : { top: `${btn.bottom + 4}px`, bottom: 'auto' }),
      zIndex: '5000', // popovers are above every modal (1500–2000)
    },
  }
}
