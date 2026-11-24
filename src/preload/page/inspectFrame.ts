/// <reference lib="dom" />
import { INSPECT_MARK as C } from '../../shared/browser/pageMarks'
import { hex, type ElementInfo } from './inspectInfo'

/**
 * The inspector's drawing over the page: the element's box (margin, padding, content — as DevTools paints them),
 * its outline, the card beside it, an element shown from the log. One host of its own with a closed shadow root,
 * never in the way of the pointer (pointer-events: none) — the page under it works as usual.
 */
const STYLE = `
  :host { all: initial }
  .l { position: fixed; pointer-events: none; box-sizing: border-box }
  .m { border-style: solid; border-color: ${C.margin} }
  .p { border-style: solid; border-color: ${C.padding} }
  .c { background: ${C.content} }
  .o { outline: 1px solid ${C.line}; outline-offset: -1px }
  .o.pin { outline: 2px solid ${C.pinned}; outline-offset: -2px }
  .k { outline: 2px dashed ${C.shown}; outline-offset: -2px; background: ${C.shownFill} }
  .card { position: fixed; max-width: 360px; min-width: 200px; padding: 8px 10px; border: 1px solid ${C.cardLine}; border-radius: 6px; background: ${C.card}; color: ${C.text};
    font: 12px/1.45 "Segoe UI", system-ui, sans-serif; box-shadow: 0 6px 24px ${C.shadow}; pointer-events: none }
  .h { display: flex; gap: 8px; align-items: baseline; font: 12px/1.4 Consolas, monospace; white-space: nowrap; overflow: hidden }
  .h .n { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0 }
  .tag { color: ${C.tag} } .id { color: ${C.id} } .cls { color: ${C.cls} } .dim { color: ${C.muted}; flex: none }
  .comp { margin-top: 2px; color: ${C.good}; font-size: 11.5px }
  .r { display: flex; gap: 8px; margin-top: 3px }
  .r b { flex: none; width: 74px; color: ${C.muted}; font-weight: normal }
  .r span { min-width: 0; overflow-wrap: anywhere }
  .sw { display: inline-block; width: 10px; height: 10px; margin-right: 4px; border: 1px solid ${C.cardLine}; border-radius: 2px; vertical-align: -1px }
  .good { color: ${C.good} } .warn { color: ${C.warn} } .bad { color: ${C.bad} }
  .hint { margin-top: 6px; padding-top: 5px; border-top: 1px solid ${C.cardLine}; color: ${C.muted}; font-size: 11px }
  .lbl { position: fixed; padding: 1px 6px; border-radius: 3px; background: ${C.shown}; color: #fff; font: 11px/1.5 Consolas, monospace; pointer-events: none; white-space: nowrap }
`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const box = (v: number[]) => (v.every((n) => n === v[0]) ? `${v[0]}` : v[1] === v[3] && v[0] === v[2] ? `${v[0]} ${v[1]}` : v.join(' '))
const swatch = (c: string) => `<i class="sw" style="background:${esc(c)}"></i>${esc(hex(c))}`
const CONTRAST_CLASS: Record<string, string> = { AAA: 'good', AA: 'good', 'AA крупный': 'warn', мало: 'bad' }

/** The card's rows for an element: only what tells something (no «static», no zero box). */
function cardHtml(i: ElementInfo, pinned: boolean): string {
  const row = (label: string, html: string) => `<div class="r"><b>${label}</b><span>${html}</span></div>`
  const rows: string[] = []
  if (i.font) rows.push(row('Шрифт', esc(`${i.font.size} / ${i.font.lineHeight} · ${i.font.weight} · ${i.font.family}`)))
  if (i.font) rows.push(row('Цвет', `${swatch(i.color)}${i.contrast ? ` · контраст <span class="${CONTRAST_CLASS[i.contrast.level]}">${i.contrast.ratio} ${esc(i.contrast.level)}</span>` : ''}`))
  if (!/rgba\(0, 0, 0, 0\)/.test(i.background)) rows.push(row('Фон', swatch(i.background)))
  rows.push(row('Блок', esc([i.display, i.layout, i.position !== 'static' ? i.position : '', i.zIndex ? `z ${i.zIndex}` : '', i.opacity ? `opacity ${i.opacity}` : '', i.overflow ? `overflow ${i.overflow}` : ''].filter(Boolean).join(' · '))))
  const spaces = [i.margin.some(Boolean) ? `margin ${box(i.margin)}` : '', i.border.some(Boolean) ? `рамка ${box(i.border)}` : '', i.padding.some(Boolean) ? `padding ${box(i.padding)}` : '', i.radius !== '0px' ? `скругл. ${i.radius}` : '']
  if (spaces.some(Boolean)) rows.push(row('Отступы', esc(spaces.filter(Boolean).join(' · '))))
  if (i.role || i.name) rows.push(row('Доступность', `${esc(i.role ?? '—')}${i.name ? ` «${esc(i.name)}»` : ''}${i.focusable ? ' · фокус ✓' : ''}`))
  rows.push(row('Дерево', `детей ${i.children}${i.matches > 1 ? ` · таких же (${esc(i.sig)}) ${i.matches}` : ''}`))
  const name = `<span class="tag">${esc(i.tag)}</span>${i.id ? `<span class="id">#${esc(i.id)}</span>` : ''}${i.classes.length ? `<span class="cls">.${esc(i.classes.join('.'))}</span>` : ''}`
  return `<div class="h"><span class="n">${name}</span><span class="dim">${i.width} × ${i.height}</span></div>${i.component ? `<div class="comp">⚛ ${esc(i.component)}</div>` : ''}${rows.join('')}<div class="hint">${pinned ? 'Закреплён · Esc — снять' : 'Alt+клик — закрепить'} · Alt+↑ родитель · Alt+↓ ребёнок · ПКМ — меню</div>`
}

type Rect = { x: number; y: number; width: number; height: number }
const at = (el: HTMLElement, r: Rect) => Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${Math.max(0, r.width)}px`, height: `${Math.max(0, r.height)}px` })

export class InspectFrame {
  private host?: HTMLElement
  private parts?: Record<'m' | 'p' | 'c' | 'o' | 'card' | 'k' | 'lbl', HTMLElement>

  /** The page's own top-layer elements (modal dialogs, open popovers) seen last — one more opened: ours goes over it again. */
  private tops: Element[] = []

  private ensure(): NonNullable<InspectFrame['parts']> {
    if (this.host?.isConnected && this.parts) {
      this.overTops(this.host)
      return this.parts
    }
    const host = document.createElement('qvarch-inspect')
    // a popover of its own: in the browser's top layer — over the page's modal dialogs too (no z-index is above them)
    host.setAttribute('popover', 'manual')
    host.setAttribute('style', 'all: initial; position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: visible; pointer-events: none; z-index: 2147483647')
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>${STYLE}</style><div class="l m"></div><div class="l p"></div><div class="l c"></div><div class="l o"></div><div class="l k" hidden></div><div class="lbl" hidden></div><div class="card"></div>`
    const q = (s: string) => root.querySelector(s) as HTMLElement
    this.parts = { m: q('.m'), p: q('.p'), c: q('.c'), o: q('.o'), k: q('.k'), lbl: q('.lbl'), card: q('.card') }
    document.documentElement.appendChild(host)
    this.host = host
    this.tops = []
    this.overTops(host)
    return this.parts
  }
  /** Ours the last in the top layer: shown again when the page put a dialog / popover there after it. */
  private overTops(host: HTMLElement): void {
    let tops: Element[]
    try {
      tops = [...document.querySelectorAll('dialog:modal, :popover-open')].filter((e) => e !== host)
    } catch {
      tops = []
    }
    const fresh = tops.some((e) => !this.tops.includes(e))
    this.tops = tops
    try {
      if (!host.matches(':popover-open')) host.showPopover()
      else if (fresh) {
        host.hidePopover()
        host.showPopover()
      }
    } catch {
      // (no popovers here — the z-index carries it)
    }
  }
  /** The element's box and card drawn (`pointer` — the card keeps out from under it). */
  draw(el: Element, info: ElementInfo, pinned: boolean, pointer?: { x: number; y: number }): void {
    const p = this.ensure()
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const n = (k: string) => Math.max(0, parseFloat(s.getPropertyValue(k)) || 0)
    const [mt, mr, mb, ml] = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'].map(n)
    const [bt, br, bb, bl] = ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'].map(n)
    const [pt, pr, pb, pl] = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map(n)
    at(p.m, { x: r.x - ml, y: r.y - mt, width: r.width + ml + mr, height: r.height + mt + mb })
    p.m.style.borderWidth = `${mt}px ${mr}px ${mb}px ${ml}px`
    const pad = { x: r.x + bl, y: r.y + bt, width: r.width - bl - br, height: r.height - bt - bb }
    at(p.p, pad)
    p.p.style.borderWidth = `${pt}px ${pr}px ${pb}px ${pl}px`
    at(p.c, { x: pad.x + pl, y: pad.y + pt, width: pad.width - pl - pr, height: pad.height - pt - pb })
    at(p.o, r)
    p.o.classList.toggle('pin', pinned)
    for (const k of ['m', 'p', 'c', 'o', 'card'] as const) p[k].hidden = false
    p.card.innerHTML = cardHtml(info, pinned)
    this.placeCard(p.card, r, pointer)
  }
  /** Below the element when there is room, else above, else inside its top; never under the pointer. */
  private placeCard(card: HTMLElement, r: DOMRect, pointer?: { x: number; y: number }): void {
    const w = card.offsetWidth
    const h = card.offsetHeight
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const x = Math.max(4, Math.min(r.x, vw - w - 4))
    const below = r.bottom + 6
    const above = r.y - h - 6
    const spots = [below + h <= vh ? below : undefined, above >= 0 ? above : undefined, Math.max(4, Math.min(r.y + 4, vh - h - 4))].filter((v): v is number => v !== undefined)
    const free = (y: number) => !pointer || pointer.x < x - 8 || pointer.x > x + w + 8 || pointer.y < y - 8 || pointer.y > y + h + 8
    const y = spots.find(free) ?? (pointer && pointer.y < vh / 2 ? vh - h - 4 : 4)
    card.style.left = `${x}px`
    card.style.top = `${y}px`
  }
  /** The frame and card gone (the pointer left the page, the inspector off). */
  clear(): void {
    if (!this.parts) return
    for (const k of ['m', 'p', 'c', 'o', 'card'] as const) this.parts[k].hidden = true
  }
  /** An element shown from the log: a dashed frame with its path. */
  mark(el: Element | null, label = ''): void {
    const p = this.ensure()
    p.k.hidden = !el
    p.lbl.hidden = !el
    if (!el) return
    const r = el.getBoundingClientRect()
    at(p.k, r)
    p.lbl.textContent = label.slice(0, 80)
    p.lbl.style.left = `${Math.max(2, r.x)}px`
    p.lbl.style.top = `${r.y > 20 ? r.y - 19 : r.bottom + 2}px`
  }
  /** Everything taken off the page. */
  remove(): void {
    this.host?.remove()
    this.host = undefined
    this.parts = undefined
  }
}
