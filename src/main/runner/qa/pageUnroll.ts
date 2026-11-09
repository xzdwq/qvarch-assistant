/**
 * A page made whole for its layout picture, in the page itself (each function is sent there as it is — nothing from
 * outside it). Many apps scroll not the window but a box of their own (body, or the app's frame — a screen high,
 * overflow auto): the document is one screen tall then, and a picture of it shows that screen only. Such a box is
 * scrolled through (what is drawn only once seen gets drawn) and then laid out whole — its height and its ancestors'
 * limits taken off — for the measure and the picture; put back after.
 */

/** The page scrolled down a screen at a time and back up — the window, and the box that scrolls it (at most 40 steps). */
export async function revealPage(): Promise<void> {
  const main = (() => {
    let best: Element | undefined
    for (const el of document.querySelectorAll('body, body *')) {
      const st = getComputedStyle(el)
      if (!/(auto|scroll)/.test(st.overflowY) || el.scrollHeight <= el.clientHeight + 10 || el.clientHeight < innerHeight * 0.5) continue
      if (!best || el.scrollHeight > best.scrollHeight) best = el
    }
    return best
  })()
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const step = Math.max(200, Math.round(innerHeight * 0.8))
  for (const box of [document.scrollingElement ?? document.documentElement, ...(main ? [main] : [])]) {
    for (let y = 0, n = 0; y < box.scrollHeight && n < 40; y += step, n++) {
      box.scrollTop = y
      await wait(120)
    }
    box.scrollTop = 0
  }
  await wait(300)
}

/**
 * The box that scrolls the page laid out whole (none — the window scrolls it: nothing to do): its height and overflow
 * and its ancestors' let go, the old inline styles kept on the page to put back. True — something was let go.
 */
export function unrollPage(): boolean {
  const doc = document.scrollingElement ?? document.documentElement
  let main: HTMLElement | undefined
  for (const el of document.querySelectorAll<HTMLElement>('body, body *')) {
    const st = getComputedStyle(el)
    if (!/(auto|scroll)/.test(st.overflowY) || el.scrollHeight <= el.clientHeight + 10 || el.clientHeight < innerHeight * 0.5) continue
    if (!main || el.scrollHeight > main.scrollHeight) main = el
  }
  // (the window scrolls the page itself, its whole length already there)
  if (!main || doc.scrollHeight >= main.scrollHeight) return false
  const kept: Array<[HTMLElement, string]> = []
  for (let el: HTMLElement | null = main; el; el = el.parentElement) {
    kept.push([el, el.getAttribute('style') ?? ''])
    // (its height let go — a box as tall as its content scrolls nothing; its overflow left as it is: what it cuts
    // sideways is what the check looks at; a box held by top + bottom let go too)
    el.style.setProperty('height', 'auto', 'important')
    el.style.setProperty('max-height', 'none', 'important')
    const pos = getComputedStyle(el).position
    if (pos === 'absolute' || pos === 'fixed') el.style.setProperty('bottom', 'auto', 'important')
    // (a fixed frame lengthens nothing: as an absolute one it makes the document as long as it is)
    if (pos === 'fixed') el.style.setProperty('position', 'absolute', 'important')
  }
  ;(window as unknown as { __qaUnrolled?: Array<[HTMLElement, string]> }).__qaUnrolled = kept
  return true
}

/** The page as it was before unrollPage (its inline styles back). */
export function rollPageBack(): void {
  const w = window as unknown as { __qaUnrolled?: Array<[HTMLElement, string]> }
  for (const [el, style] of w.__qaUnrolled ?? []) {
    if (style) el.setAttribute('style', style)
    else el.removeAttribute('style')
  }
  delete w.__qaUnrolled
}
