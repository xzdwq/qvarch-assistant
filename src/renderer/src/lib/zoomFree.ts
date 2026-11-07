/**
 * The CSS zoom an element is drawn at: its ancestors' zoom multiplied (the app's zoom on <main>, the terminal dock's).
 * A widget that maps the pointer by its own measures (xterm) goes wrong under it — the further from its top, the more.
 */
export function ancestorsZoom(el: HTMLElement): number {
  let z = 1
  for (let e = el.parentElement; e; e = e.parentElement) {
    const v = parseFloat(getComputedStyle(e).zoom)
    if (Number.isFinite(v) && v > 0) z *= v
  }
  return z
}
