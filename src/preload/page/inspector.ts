/// <reference lib="dom" />
import type { HideWay, InspectCommand, PinMove, TargetInfo } from '../../shared/browser/inspect/pageCommands'
import { askMain, onMain, sendMain } from '../pageIpc'
import { sigOf } from '../recorder/cssPath'
import { locatorFor } from '../recorder/locators'
import { InspectFrame } from './inspectFrame'
import { bridgeComponents, elementInfo } from './inspectInfo'

/**
 * The inspector in a browser page (on while main says so — a new page asks): the element under the pointer framed
 * with its card — any element: a block, a text, an icon; Alt+click pins one (Alt+↑ / Alt+↓ — its parent / child,
 * Esc — let go); the element right-clicked is the menu's target. Main's commands act on the target: hide it, bring
 * the hidden back, edit its text, its locator; show an element of the log. Drawn once a frame at most.
 */
const frame = new InspectFrame()
let on = false
let hovered: Element | null = null
let pinned: Element | null = null
/** The element the page's menu is about (right-clicked last). */
let menuTarget: Element | null = null
let pointer: { x: number; y: number } | undefined
let raf = 0
let ac: AbortController | undefined
/** What was hidden / removed, to bring back (the latest last). */
const hidden: Array<{ el: Element; how: HideWay; style: string | null; parent?: Node | null; next?: Node | null }> = []
const editing = new Map<HTMLElement, string | null>()
let markTimer: ReturnType<typeof setTimeout> | undefined

/** The deepest element at a point, through open shadow roots (our own host is never hit: it takes no pointer). */
function deepAt(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  return el
}
const parentOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host || null)
const shown = () => pinned ?? hovered

/** The card's facts of the element shown (read again only when another element is shown, or a moment has passed). */
let info: { el: Element; at: number; data: ReturnType<typeof elementInfo> } | undefined
const INFO_FRESH_MS = 1000
function draw(): void {
  raf = 0
  // (the element under the pointer read now: the page may have scrolled, a dialog opened under a still pointer)
  if (!pinned) hovered = pointer ? deepAt(pointer.x, pointer.y) : null
  const el = shown()
  if (!on || !el || !el.isConnected) return frame.clear()
  if (info?.el !== el || performance.now() - info.at > INFO_FRESH_MS) info = { el, at: performance.now(), data: elementInfo(el, sigOf(el)) }
  frame.draw(el, info.data, !!pinned, pointer)
}
const redraw = () => void (raf ||= requestAnimationFrame(draw))

function start(): void {
  if (on) return
  on = true
  bridgeComponents()
  ac = new AbortController()
  const o = { capture: true, passive: true, signal: ac.signal }
  addEventListener(
    'mousemove',
    (e) => {
      pointer = { x: e.clientX, y: e.clientY }
      // (the element under it is read when drawn; the card moves aside from the pointer even over the same element)
      redraw()
    },
    o,
  )
  // the pointer left the page (to the app, another window): the frame goes — a move out with nothing to go to
  document.addEventListener(
    'mouseout',
    (e) => {
      if (e.relatedTarget) return
      pointer = undefined
      redraw()
    },
    { capture: true, signal: ac.signal },
  )
  addEventListener('scroll', redraw, o)
  addEventListener('resize', redraw, { signal: ac.signal })
  addEventListener('click', onAltClick, { capture: true, signal: ac.signal })
  addEventListener('keydown', onKey, { capture: true, signal: ac.signal })
}
function stop(): void {
  on = false
  ac?.abort()
  hovered = pinned = null
  frame.remove()
}
function onAltClick(e: MouseEvent): void {
  if (!e.altKey || !e.isTrusted) return
  e.preventDefault()
  e.stopImmediatePropagation()
  const el = deepAt(e.clientX, e.clientY)
  pinned = pinned === el ? null : el
  redraw()
}
/** The keys while the inspector is on: Alt+↑ / Alt+↓ — the parent / first child pinned; Esc — let go. */
const KEYS: Record<string, (e: KeyboardEvent) => boolean> = {
  ArrowUp: (e) => e.altKey && move('parent'),
  ArrowDown: (e) => e.altKey && move('child'),
  Escape: () => !!pinned && move('none'),
}
function onKey(e: KeyboardEvent): void {
  if (Object.hasOwn(KEYS, e.key) && KEYS[e.key](e)) {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}
function move(to: PinMove): boolean {
  const from = pinned ?? menuTarget ?? hovered
  const next: Record<PinMove, () => Element | null> = { parent: () => from && parentOf(from), child: () => from?.firstElementChild ?? null, here: () => menuTarget, none: () => null }
  const el = next[to]()
  if (to !== 'none' && !el) return false
  pinned = el
  if (el) menuTarget = el
  redraw()
  return true
}

// ---------- the menu's target and main's commands ----------
// (always — the page's menu copies even with the inspector off: its element is the one right-clicked)
addEventListener(
  'contextmenu',
  (e) => {
    const deep = (e.composedPath()[0] as Element) ?? e.target
    if (!(deep instanceof Element)) return
    menuTarget = pinned && pinned.contains(deep) ? pinned : deep
    if (pinned && menuTarget !== pinned) pinned = null
  },
  true,
)
const target = () => (menuTarget?.isConnected ? menuTarget : null) ?? pinned ?? hovered

/** How to find the target again from a point: the element at a point inside it, then how many parents up. */
function reach(el: Element): { point: { x: number; y: number }; up: number } {
  const r = el.getBoundingClientRect()
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const xs = [r.x + r.width / 2, r.x + 2, r.right - 2].map((x) => Math.min(vw - 1, Math.max(0, x)))
  const ys = [r.y + r.height / 2, r.y + 2, r.bottom - 2].map((y) => Math.min(vh - 1, Math.max(0, y)))
  for (const x of xs)
    for (const y of ys) {
      let hit = deepAt(x, y)
      let up = 0
      while (hit && hit !== el && up < 200) {
        hit = parentOf(hit)
        up++
      }
      if (hit === el) return { point: { x, y }, up }
    }
  return { point: { x: xs[0], y: ys[0] }, up: -1 }
}
function describe(el: Element): TargetInfo {
  const r = el.getBoundingClientRect()
  const cls = [...el.classList].slice(0, 2).join('.')
  return {
    label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`,
    width: Math.round(r.width),
    height: Math.round(r.height),
    view: { x: r.x, y: r.y, width: r.width, height: r.height },
    doc: { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height },
    ...reach(el),
    pinned: !!pinned,
    editing: editing.has(el as HTMLElement),
    hidden: hidden.length,
  }
}
function hide(el: Element, how: HideWay): number {
  hidden.push({ el, how, style: el.getAttribute('style'), parent: el.parentNode, next: el.nextSibling })
  const HIDES: Record<HideWay, () => void> = {
    display: () => (el as HTMLElement).style.setProperty('display', 'none', 'important'),
    visibility: () => (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important'),
    remove: () => el.remove(),
  }
  HIDES[how]()
  if (pinned === el) pinned = null
  menuTarget = null
  redraw()
  return hidden.length
}
function restore(): number {
  for (const h of hidden.splice(0).reverse()) {
    if (h.how === 'remove') h.parent?.insertBefore(h.el, h.next && h.next.parentNode === h.parent ? h.next : null)
    else if (h.style === null) h.el.removeAttribute('style')
    else h.el.setAttribute('style', h.style)
  }
  redraw()
  return 0
}
/** The target's text editable right on the page (again — back as it was). */
function edit(el: HTMLElement): boolean {
  if (editing.has(el)) {
    const was = editing.get(el)
    if (was === null) el.removeAttribute('contenteditable')
    else el.setAttribute('contenteditable', was ?? '')
    editing.delete(el)
    return false
  }
  editing.set(el, el.getAttribute('contenteditable'))
  el.setAttribute('contenteditable', 'true')
  el.spellcheck = false
  el.focus()
  return true
}
function xpathOf(el: Element): string {
  const parts: string[] = []
  for (let e: Element | null = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
      parts.unshift(`//*[@id="${e.id}"]`)
      return parts.join('/')
    }
    const same = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e!.tagName) : []
    parts.unshift(`${e.tagName.toLowerCase()}${same.length > 1 ? `[${same.indexOf(e) + 1}]` : ''}`)
  }
  return `/${parts.join('/')}`
}
function mark(selector: string, scroll: boolean): boolean {
  clearTimeout(markTimer)
  let el: Element | null = null
  try {
    el = document.querySelector(selector)
  } catch {
    // (a path of an older page)
  }
  if (el && scroll) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    markTimer = setTimeout(() => frame.mark(null), 2500)
  }
  // (drawn now and again as the smooth scroll goes)
  const paint = () => frame.mark(el, selector)
  paint()
  if (el && scroll) for (const ms of [150, 350, 600]) setTimeout(paint, ms)
  return !!el
}

/** Each command: what it does with the target (none — nothing to answer). */
const COMMANDS: { [K in InspectCommand['t']]: (c: Extract<InspectCommand, { t: K }>) => unknown } = {
  target: () => {
    const el = target()
    return el ? describe(el) : null
  },
  hide: (c) => {
    const el = target()
    return el ? hide(el, c.how) : null
  },
  restore: () => restore(),
  edit: () => {
    const el = target()
    return el instanceof HTMLElement ? edit(el) : null
  },
  pin: (c) => move(c.to),
  mark: (c) => mark(c.selector, c.scroll),
  unmark: () => (clearTimeout(markTimer), frame.mark(null)),
  text: () => (target() as HTMLElement | null)?.innerText ?? target()?.textContent ?? null,
  xpath: () => {
    const el = target()
    return el ? xpathOf(el) : null
  },
  locator: () => {
    const el = target()
    return el ? locatorFor(el) : null
  },
}

onMain('inspect', (v) => (v ? start() : stop()))
onMain('inspectCmd', (id, cmd) => {
  let answer: unknown = null
  try {
    if (Object.hasOwn(COMMANDS, cmd.t)) answer = (COMMANDS[cmd.t] as (c: InspectCommand) => unknown)(cmd) ?? null
  } catch {
    answer = null
  }
  sendMain('inspectReply', id, answer)
})
void askMain('inspectGet').then((v) => v && start())
