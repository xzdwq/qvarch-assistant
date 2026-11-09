/**
 * What the `qa` checks look at inside the page — each a function Playwright sends there and runs as it is (so each
 * is whole in itself: no imports, nothing from outside it). The UI kits' selectors by role come as its argument.
 */
import type { UiSelectors } from '../../../shared/browser/uiKits'

/** What the page shows wrong in its geometry now (the layout check), each with its box in the page. */
export interface Flaw {
  kind: string
  text: string
  x: number
  y: number
  w: number
  h: number
}
/** The page's geometry looked at (runs in the page). */
export const layoutProbe = (ui: UiSelectors) => {
  const out: Array<{ kind: string; text: string; x: number; y: number; w: number; h: number }> = []
  const W = innerWidth
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect()
    return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'
  }
  const txt = (e: Element) => ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()
  const add = (kind: string, el: Element, text: string, box?: DOMRect | { left: number; top: number; width: number; height: number }) => {
    if (out.length >= 60) return
    const r = box ?? el.getBoundingClientRect()
    out.push({ kind, text: text.slice(0, 80), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height })
  }
  /**
   * The part of an element one really sees: its box cut by every ancestor that clips (a table's own scroll,
   * a panel with overflow hidden). A cell scrolled away inside its table is not «past the edge» — it is hidden.
   */
  const shown = (el: Element): { left: number; top: number; right: number; bottom: number; width: number; height: number } | undefined => {
    const r = el.getBoundingClientRect()
    let l = r.left
    let t = r.top
    let rt = r.right
    let b = r.bottom
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p)
      if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
        const c = p.getBoundingClientRect()
        if (st.overflowX !== 'visible') ((l = Math.max(l, c.left)), (rt = Math.min(rt, c.right)))
        if (st.overflowY !== 'visible') ((t = Math.max(t, c.top)), (b = Math.min(b, c.bottom)))
      }
      if (rt - l <= 1 || b - t <= 1) return undefined
    }
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t }
  }
  /** Stuck to the screen (a sticky header, a fixed bar): content scrolls under it — that is no overlap. */
  const stuck = (el: Element) => {
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position
      if (pos === 'sticky' || pos === 'fixed') return true
    }
    return false
  }
  const over = document.documentElement.scrollWidth - W
  const hscroll = over > 4 && getComputedStyle(document.documentElement).overflowX !== 'hidden' ? over : 0
  // text out of its cell (spilling over the neighbours)
  const cells = document.querySelectorAll('td, th, [role="cell"], [role="gridcell"], [role="columnheader"]')
  for (let i = 0; i < cells.length && i < 3000; i++) {
    const el = cells[i]
    if (el.scrollWidth <= el.clientWidth + 2 || !vis(el)) continue
    const s = getComputedStyle(el)
    if (s.overflowX !== 'visible' || s.textOverflow === 'ellipsis') continue
    let cut = false
    for (const k of [...el.querySelectorAll('*')].slice(0, 50)) {
      const ks = getComputedStyle(k)
      if (ks.textOverflow === 'ellipsis' || (ks.overflowX !== 'visible' && k.scrollWidth > k.clientWidth)) cut = true
    }
    if (cut) continue
    const range = document.createRange()
    range.selectNodeContents(el)
    const tr = range.getBoundingClientRect()
    const cr = el.getBoundingClientRect()
    if (txt(el) && (tr.right > cr.right + 2 || tr.left < cr.left - 2)) add('Текст вылезает из ячейки', el, txt(el))
  }
  // text cut off: the text itself measured against what one sees of it — its box cut by the element and every
  // ancestor that really clips (overflow hidden / clip; a scroll is no cut — one scrolls to the rest). Partly seen
  // and going past it — cut; wholly out of sight — hidden on purpose (a slide); an ellipsis / line clamp — meant.
  const hides = (v: string) => v === 'hidden' || v === 'clip'
  /**
   * The room one sees an element's content in: cut only by what really clips — the element itself and its ancestors
   * (a scroll and a box the text merely spills from cut nothing); its ellipsis meant only when the text's own block
   * has it — an ellipsis works on a block's own lines: an ancestor's (a row with truncate) cuts a nested box bare.
   */
  const seenOf = (el: Element): { l: number; t: number; r: number; b: number; meant: boolean } => {
    let l = -Infinity
    let t = -Infinity
    let r = Infinity
    let b = Infinity
    let meant = false
    // the text's own block: the element, or — an inline one — the nearest box that lays its lines out
    let block: Element = el
    while (block.parentElement && /^(inline|contents)$/.test(getComputedStyle(block).display)) block = block.parentElement
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p)
      const cx = hides(st.overflowX)
      const cy = hides(st.overflowY)
      if (!cx && !cy) continue
      if (p === block && (st.textOverflow === 'ellipsis' || (st.webkitLineClamp && st.webkitLineClamp !== 'none'))) meant = true
      const c = p.getBoundingClientRect()
      if (cx) ((l = Math.max(l, c.left)), (r = Math.min(r, c.right)))
      if (cy) ((t = Math.max(t, c.top)), (b = Math.min(b, c.bottom)))
    }
    return { l, t, r, b, meant }
  }
  type Box = { l: number; t: number; r: number; b: number }
  /** An element's own text (its text nodes, not its children's elements): each line's box and the whole. */
  const ownText = (el: Element): { lines: Box[]; box: Box } | undefined => {
    const lines: Box[] = []
    for (const n of el.childNodes) {
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const q of range.getClientRects()) if (q.width >= 1 && q.height >= 1) lines.push({ l: q.left, t: q.top, r: q.right, b: q.bottom })
    }
    if (!lines.length) return undefined
    return { lines, box: { l: Math.min(...lines.map((x) => x.l)), t: Math.min(...lines.map((x) => x.t)), r: Math.max(...lines.map((x) => x.r)), b: Math.max(...lines.map((x) => x.b)) } }
  }
  const drawn = (st: CSSStyleDeclaration) => st.backgroundImage !== 'none' || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor) || parseFloat(st.borderTopWidth) > 0
  /**
   * The drawn box a thing pokes out of (its boxes' corners outside it — its rounding counted): the nearest one up the
   * tree it does not fit — a background, an image, a border (`self` — the element's own counts: a circle holding its
   * text). None — it fits them, or hangs out on purpose (absolute / fixed: a badge, a menu, a hint), or something on
   * the way clips or scrolls (cut or scrolled to — the cut check's).
   */
  const outsideOf = (el: Element, boxes: readonly Box[], self: boolean): { box: Element; clips: boolean } | undefined => {
    for (let p: Element | null = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p)
      if (st.position === 'absolute' || st.position === 'fixed') return undefined
      if ((self || p !== el) && drawn(st) && !boxes.every((q) => [q.l, q.r].every((x) => [q.t, q.b].every((y) => inShape(x, y, p!)))))
        return { box: p, clips: hides(st.overflowX) || hides(st.overflowY) }
      if (p !== el && (st.overflowX !== 'visible' || st.overflowY !== 'visible')) return undefined
    }
    return undefined
  }
  /** A point inside a rounded box (its corners' ellipses; 2 px leeway — a pill's text is no fault). */
  const inShape = (x: number, y: number, shape: Element): boolean => {
    const st = getComputedStyle(shape)
    const r = shape.getBoundingClientRect()
    const px = (v: string, base: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * base : parseFloat(v) || 0)
    const radius = (v: string): [number, number] => {
      const [h, w = h] = v.split(' ')
      return [px(h, r.width), px(w, r.height)]
    }
    const E = 2
    if (x < r.left - E || x > r.right + E || y < r.top - E || y > r.bottom + E) return false
    const tl = radius(st.borderTopLeftRadius)
    const tr = radius(st.borderTopRightRadius)
    const br = radius(st.borderBottomRightRadius)
    const bl = radius(st.borderBottomLeftRadius)
    // (corners too large for their sides are all scaled down by one factor — as the browser draws them: a pill's ends
    // are half its height, whatever 999px says)
    const k = Math.min(1, r.width / (tl[0] + tr[0] || 1), r.width / (bl[0] + br[0] || 1), r.height / (tl[1] + bl[1] || 1), r.height / (tr[1] + br[1] || 1))
    const corners: Array<[[number, number], number, number, number, number]> = [
      [tl, r.left, r.top, 1, 1],
      [tr, r.right, r.top, -1, 1],
      [br, r.right, r.bottom, -1, -1],
      [bl, r.left, r.bottom, 1, -1],
    ]
    for (const [[rx0, ry0], cx0, cy0, sx, sy] of corners) {
      const rx = rx0 * k
      const ry = ry0 * k
      if (rx <= 0 || ry <= 0) continue
      const cx = cx0 + sx * rx
      const cy = cy0 + sy * ry
      // (the corner's own square: beyond its ellipse — outside)
      if ((x - cx) * sx < 0 && (y - cy) * sy < 0 && ((x - cx) / (rx + E)) ** 2 + ((y - cy) / (ry + E)) ** 2 > 1) return false
    }
    return true
  }
  /**
   * Past the screen's right edge: the part of a box one could see (cut by every ancestor that clips or scrolls — a
   * scroller's own rest is reached by scrolling it; the element itself too — a text in its own scroller) — partly past
   * it: always; wholly past it: when the page itself scrolls sideways (that is where it went), never for a panel kept
   * off the screen (fixed / sticky — a side menu).
   */
  const pastRightEdge = (el: Element, box: Box): Box | undefined => {
    let { l, t, r, b } = box
    for (let p: Element | null = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p)
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue
      const c = p.getBoundingClientRect()
      if (st.overflowX !== 'visible') ((l = Math.max(l, c.left)), (r = Math.min(r, c.right)))
      if (st.overflowY !== 'visible') ((t = Math.max(t, c.top)), (b = Math.min(b, c.bottom)))
    }
    if (r - l <= 1 || b - t <= 1 || r <= W + 2 || stuck(el)) return undefined
    if (l >= W - 1 && !hscroll) return undefined
    return { l, t, r, b }
  }
  const holders = new Set<Element>()
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n && holders.size < 2000; n = walk.nextNode()) {
    const p = n.parentElement
    if (p && n.textContent?.trim() && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(p.tagName)) holders.add(p)
  }
  for (const el of holders) {
    if (!vis(el)) continue
    const own = ownText(el)
    if (!own) continue
    const tb = own.box
    const v = seenOf(el)
    // (nothing of it seen — hidden on purpose)
    if (tb.r <= v.l || tb.l >= v.r || tb.b <= v.t || tb.t >= v.b) continue
    // an ellipsis is meant when there is room for a few characters; a box squeezed to a letter or two (a flex row
    // pressing a «truncate» number) cuts the text, ellipsis or not
    if (v.meant) {
      const seenW = Math.min(tb.r, v.r) - Math.max(tb.l, v.l)
      if (tb.r - tb.l <= seenW + 2 || seenW >= 3 * (parseFloat(getComputedStyle(el).fontSize) || 16)) continue
    }
    if (tb.r > v.r + 2 || tb.l < v.l - 2 || tb.b > v.b + 2 || tb.t < v.t - 2) {
      // (outlined where it is seen: the text's box within the room)
      const l = Math.max(tb.l, v.l)
      const t = Math.max(tb.t, v.t)
      add('Текст обрезан', el, txt(el), { left: l, top: t, width: Math.min(tb.r, v.r) - l, height: Math.min(tb.b, v.b) - t })
      continue
    }
    // past the screen's right edge (the page scrolls sideways, or the screen cuts it)
    const past = pastRightEdge(el, tb)
    if (past) {
      add('За правым краем экрана', el, txt(el), { left: past.l, top: past.t, width: past.r - past.l, height: past.b - past.t })
      continue
    }
    // inside what clips it, but out of the box it is drawn on (a circle's text over its edge): cut when that box clips
    const out = outsideOf(el, own.lines, true)
    if (out) add(out.clips ? 'Текст обрезан' : 'Текст выходит за край блока', el, txt(el), { left: tb.l, top: tb.t, width: tb.r - tb.l, height: tb.b - tb.t })
  }
  // controls: out past the right edge; on top of each other
  // (only what is seen: a control hidden in its container's scroll is neither past the edge nor overlapping)
  /** Not seen at all: transparent (a checkbox's native input stretched over it), hidden from people. */
  const ghost = (el: Element) => {
    if (el.closest('[aria-hidden="true"]')) return true
    if (el instanceof HTMLInputElement && /^(checkbox|radio|file|range|color)$/.test(el.type)) return true
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) if (Number(getComputedStyle(p).opacity) < 0.05) return true
    return false
  }
  const things = [...document.querySelectorAll(`img, svg, video, canvas, a[href], input:not([type="hidden"]), select, textarea, ${ui.button}, ${ui.field}, ${ui.tab}`)].filter(
    (el) => vis(el) && !ghost(el) && !el.parentElement?.closest('svg'),
  )
  const poked: Element[] = []
  for (const el of things) {
    if (poked.some((p) => p.contains(el) || el.contains(p))) continue
    const r = el.getBoundingClientRect()
    // (a picture partly past the screen's right edge; a control's — said below with the controls)
    if (/^(IMG|svg|VIDEO|CANVAS)$/.test(el.tagName) && pastRightEdge(el, { l: r.left, t: r.top, r: r.right, b: r.bottom })) {
      poked.push(el)
      add('За правым краем экрана', el, el.getAttribute('alt') || el.getAttribute('aria-label') || el.tagName.toLowerCase())
      continue
    }
    const out = outsideOf(el, [{ l: r.left, t: r.top, r: r.right, b: r.bottom }], false)
    if (!out) continue
    poked.push(el)
    add(out.clips ? 'Обрезано краем блока' : 'Выходит за край блока', el, txt(el) || el.getAttribute('aria-label') || el.getAttribute('alt') || el.tagName.toLowerCase())
  }
  const ctl = [...document.querySelectorAll(`a[href], input:not([type="hidden"]), select, textarea, ${ui.button}, ${ui.field}, ${ui.tab}`)]
    .filter((el) => vis(el) && !ghost(el))
    .map((el) => ({ el, r: shown(el) }))
    .filter((x): x is { el: Element; r: NonNullable<ReturnType<typeof shown>> } => !!x.r)
    .slice(0, 300)
  for (const { el, r } of ctl) if (r.right > W + 2) add('За правым краем экрана', el, txt(el) || el.getAttribute('aria-label') || el.tagName.toLowerCase(), r)
  const boxes = ctl.filter((x) => !stuck(x.el))
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (w <= 0 || h <= 0) continue
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height)
      if (small > 0 && (w * h) / small > 0.3) add('Перекрываются', a.el, `${txt(a.el) || a.el.tagName.toLowerCase()} ↔ ${txt(b.el) || b.el.tagName.toLowerCase()}`, a.r)
    }
  return { hscroll, items: out }
}

/** A field as the page has it (runs in the page, on the field's element or its wrapper). */
export const fieldProbe = (el: Element, ui: UiSelectors) => {
  const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
  const inp = (el.matches('input, textarea, select, [contenteditable="true"]') ? el : el.querySelector('input, textarea, select, [contenteditable="true"]')) as HTMLInputElement | null
  const fld = el.closest(ui.field) ?? el.querySelector(ui.field) ?? el
  // its label: the kit's own, aria, else the words beside it in its row
  let label = txt(fld.querySelector(ui.fieldLabel)) || inp?.getAttribute('aria-label') || ''
  if (!label) {
    let b: Element = fld
    for (let up = 0; up < 3 && b.parentElement && !label; up++) {
      for (let p = b.previousElementSibling; p && !label; p = p.previousElementSibling) {
        if (p.querySelector(`input, textarea, select, ${ui.field}`)) break
        const t = txt(p)
        if (t && t.length < 80) label = t
      }
      b = b.parentElement
    }
  }
  const num = (s: string | null | undefined) => (s !== null && s !== undefined && s !== '' && !Number.isNaN(Number(s)) ? Number(s) : undefined)
  return {
    tag: (inp ?? el).tagName.toLowerCase(),
    type: inp?.getAttribute('type') ?? (inp?.tagName === 'TEXTAREA' ? 'textarea' : 'text'),
    inputmode: inp?.getAttribute('inputmode') ?? undefined,
    maxlength: inp && inp.maxLength > 0 ? inp.maxLength : num(fld.querySelector('[maxlength]')?.getAttribute('maxlength')),
    min: num(inp?.getAttribute('min')),
    max: num(inp?.getAttribute('max')),
    required: !!inp?.required || inp?.getAttribute('aria-required') === 'true' || /\*/.test(label) || !!fld.closest(ui.required),
    readonly: !!inp && (inp.readOnly || inp.disabled),
    select: !!el.closest(ui.selectWrap) || !!el.querySelector(ui.selectWrap) || inp?.tagName === 'SELECT',
    label: label.replace(/[:*]\s*$/, ''),
  }
}
/** What the page tells now: field errors, alerts, notifications (their words; at most a few). */
export const hintProbe = (ui: UiSelectors) => {
  const out: string[] = []
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  for (const e of document.querySelectorAll(`${ui.fieldError}, ${ui.notice}`)) {
    const t = ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()
    if (t && vis(e) && !out.includes(t)) out.push(t.slice(0, 160))
    if (out.length >= 5) break
  }
  // a field marked wrong without words: its label
  for (const e of document.querySelectorAll('[aria-invalid="true"]')) {
    if (!vis(e) || out.length >= 5) continue
    const lbl = e.closest(ui.field)?.querySelector(ui.fieldLabel)?.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('name') || 'поле'
    const t = `поле «${lbl}» отмечено как неверное`
    if (!out.includes(t)) out.push(t)
  }
  return out
}
/** What the page shows: its fields (by their labels) and its tables' rows (runs in the page). */
export const pageFieldsProbe = (ui: UiSelectors) => {
  const out: Record<string, string> = {}
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
  const put = (k: string, v: string) => {
    let key = k
    for (let n = 2; key in out; n++) key = `${k} (${n})`
    out[key] = v
  }
  const labelOf = (el: Element, i: number): string => {
    const fld = el.closest(ui.field)
    const ql = fld?.querySelector(ui.fieldLabel)
    if (ql && txt(ql)) return txt(ql)
    const aria = el.getAttribute('aria-label')
    if (aria) return aria
    // the label beside it in its row
    let b: Element = fld ?? el
    for (let up = 0; up < 3 && b.parentElement; up++) {
      for (let p = b.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.querySelector(`input, textarea, select, ${ui.field}`)) break
        const t = txt(p)
        if (t && t.length < 60) return t.replace(/[:*]\s*$/, '')
      }
      b = b.parentElement
    }
    return (el as HTMLInputElement).placeholder || el.getAttribute('name') || `поле ${i + 1}`
  }
  let i = 0
  for (const el of document.querySelectorAll(`input, textarea, select, ${ui.selectWrap}`)) {
    if (!vis(el)) continue
    if (el instanceof HTMLInputElement && /^(hidden|password|file|submit|button|image|reset)$/.test(el.type)) continue
    // a kit's select: its shown value (its own input is a search box)
    if (el.closest(ui.selectWrap) && el.tagName === 'INPUT') continue
    const v = el.matches(ui.selectWrap)
      ? txt(el.querySelector(ui.selectValue))
      : el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
        ? el.checked
          ? 'да'
          : 'нет'
        : el instanceof HTMLSelectElement
          ? txt(el.selectedOptions[0])
          : (el as HTMLInputElement).value
    put(labelOf(el, i++), v)
  }
  let t = 0
  for (const table of document.querySelectorAll('table')) {
    if (!vis(table) || t >= 3) continue
    t++
    let r = 0
    for (const tr of table.querySelectorAll('tbody tr')) {
      if (!vis(tr) || r >= 100) continue
      put(`Таблица ${t}, строка ${++r}`, txt(tr).slice(0, 300))
    }
  }
  return out
}
