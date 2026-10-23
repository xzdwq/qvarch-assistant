/**
 * What the `qa` checks look at inside the page — each a function Playwright sends there and runs as it is (so each
 * is whole in itself: no imports, nothing from outside it).
 */

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
export const layoutProbe = () => {
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
  // text cut off (a button, a label, a tab — hidden overflow, no ellipsis)
  const labels = document.querySelectorAll('button, .q-btn, label, .q-field__label, .q-tab, [role="tab"], a')
  for (let i = 0; i < labels.length && i < 1500; i++) {
    const el = labels[i]
    if (el.scrollWidth <= el.clientWidth + 2 || !vis(el)) continue
    const s = getComputedStyle(el)
    if ((s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && txt(el)) add('Текст обрезан', el, txt(el))
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
  const ctl = [...document.querySelectorAll('button, .q-btn, a[href], input:not([type="hidden"]), select, textarea, .q-field, [role="button"], [role="tab"]')]
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
export const fieldProbe = (el: Element) => {
  const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
  const inp = (el.matches('input, textarea, select, [contenteditable="true"]') ? el : el.querySelector('input, textarea, select, [contenteditable="true"]')) as HTMLInputElement | null
  const fld = el.closest('.q-field') ?? el.querySelector('.q-field') ?? el
  // its label: Quasar's own, aria, else the words beside it in its row
  let label = txt(fld.querySelector('.q-field__label')) || inp?.getAttribute('aria-label') || ''
  if (!label) {
    let b: Element = fld
    for (let up = 0; up < 3 && b.parentElement && !label; up++) {
      for (let p = b.previousElementSibling; p && !label; p = p.previousElementSibling) {
        if (p.querySelector('input, textarea, select, .q-field')) break
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
    required: !!inp?.required || inp?.getAttribute('aria-required') === 'true' || /\*/.test(label) || !!fld.closest('.required, .is-required'),
    readonly: !!inp && (inp.readOnly || inp.disabled),
    select: !!el.closest('.q-select') || !!el.querySelector('.q-select') || inp?.tagName === 'SELECT',
    label: label.replace(/[:*]\s*$/, ''),
  }
}
/** What the page tells now: field errors, alerts, notifications (their words; at most a few). */
export const hintProbe = () => {
  const out: string[] = []
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const sel =
    '.q-field--error .q-field__messages, .q-field__bottom .text-negative, .q-notification, [role="alert"], .el-form-item__error, .el-message--error, .invalid-feedback, .ant-form-item-explain-error, .Vue-Toastification__toast--error, .toast-error, .error-message'
  for (const e of document.querySelectorAll(sel)) {
    const t = ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim()
    if (t && vis(e) && !out.includes(t)) out.push(t.slice(0, 160))
    if (out.length >= 5) break
  }
  // a field marked wrong without words: its label
  for (const e of document.querySelectorAll('[aria-invalid="true"]')) {
    if (!vis(e) || out.length >= 5) continue
    const lbl = e.closest('.q-field')?.querySelector('.q-field__label')?.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('name') || 'поле'
    const t = `поле «${lbl}» отмечено как неверное`
    if (!out.includes(t)) out.push(t)
  }
  return out
}
/** What the page shows: its fields (by their labels) and its tables' rows (runs in the page). */
export const pageFieldsProbe = () => {
  const out: Record<string, string> = {}
  const vis = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'
  const txt = (e: Element | null | undefined) => (e ? ((e as HTMLElement).innerText ?? e.textContent ?? '').replace(/\s+/g, ' ').trim() : '')
  const put = (k: string, v: string) => {
    let key = k
    for (let n = 2; key in out; n++) key = `${k} (${n})`
    out[key] = v
  }
  const labelOf = (el: Element, i: number): string => {
    const fld = el.closest('.q-field')
    const ql = fld?.querySelector('.q-field__label')
    if (ql && txt(ql)) return txt(ql)
    const aria = el.getAttribute('aria-label')
    if (aria) return aria
    // the label beside it in its row
    let b: Element = fld ?? el
    for (let up = 0; up < 3 && b.parentElement; up++) {
      for (let p = b.previousElementSibling; p; p = p.previousElementSibling) {
        if (p.querySelector('input, textarea, select, .q-field')) break
        const t = txt(p)
        if (t && t.length < 60) return t.replace(/[:*]\s*$/, '')
      }
      b = b.parentElement
    }
    return (el as HTMLInputElement).placeholder || el.getAttribute('name') || `поле ${i + 1}`
  }
  let i = 0
  for (const el of document.querySelectorAll('input, textarea, select, .q-select')) {
    if (!vis(el)) continue
    if (el instanceof HTMLInputElement && /^(hidden|password|file|submit|button|image|reset)$/.test(el.type)) continue
    // a Quasar select: its shown value (its own input is a search box)
    if (el.closest('.q-select') && el.tagName === 'INPUT') continue
    const v = el.matches('.q-select')
      ? txt(el.querySelector('.q-field__native'))
      : el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
        ? el.checked ? 'да' : 'нет'
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
