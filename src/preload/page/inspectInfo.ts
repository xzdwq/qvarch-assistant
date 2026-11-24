/// <reference lib="dom" />
import { webFrame } from 'electron'

/**
 * What the inspector's card tells of an element: what it is (tag, id, classes, its framework component), its size,
 * text (font, colour, contrast against what is under it — WCAG), box (margin, border, padding, corners), layout
 * (display, flex / grid, position, z-index), accessibility (role, name, focus), its place in the tree.
 */
export interface ElementInfo {
  tag: string
  id: string
  classes: string[]
  width: number
  height: number
  component?: string
  font?: { family: string; size: string; lineHeight: string; weight: string }
  color: string
  background: string
  contrast?: { ratio: number; level: 'AAA' | 'AA' | 'AA крупный' | 'мало' }
  margin: number[]
  padding: number[]
  border: number[]
  radius: string
  display: string
  layout?: string
  position: string
  zIndex?: string
  opacity?: string
  overflow?: string
  role?: string
  name?: string
  focusable: boolean
  children: number
  /** Its kind (tag and steady classes) and how many such elements the page has. */
  sig: string
  matches: number
}

type Rgba = [number, number, number, number]
/** A computed colour (rgb() / rgba()) as numbers; anything else — none. */
function rgba(c: string): Rgba | undefined {
  const m = /rgba?\(([^)]+)\)/.exec(c)
  if (!m) return undefined
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  return [p[0], p[1], p[2], p[3] ?? 1]
}
export const hex = (c: string) => {
  const v = rgba(c)
  if (!v) return c
  const h = v
    .slice(0, 3)
    .map((n) => Math.round(n).toString(16).padStart(2, '0'))
    .join('')
  return v[3] < 1 ? `#${h} ${Math.round(v[3] * 100)}%` : `#${h}`
}
const lum = ([r, g, b]: Rgba) => {
  const f = (n: number) => ((n /= 255) <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba
/** The colour under an element: its own background or its nearest ancestor's (white at the end), the translucent ones laid over. */
function backdrop(el: Element): Rgba {
  const layers: Rgba[] = []
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = rgba(getComputedStyle(e).backgroundColor)
    if (c && c[3] > 0) {
      layers.push(c)
      if (c[3] >= 1) break
    }
  }
  return layers.reduceRight<Rgba>((under, top) => over(top, under), [255, 255, 255, 1])
}

/** The roles the tags have by themselves (ARIA's implicit roles — the common ones). */
const IMPLICIT_ROLE: Record<string, (el: Element) => string | undefined> = {
  A: (el) => (el.hasAttribute('href') ? 'link' : undefined),
  BUTTON: () => 'button',
  INPUT: (el) => ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', range: 'slider', search: 'searchbox' })[(el as HTMLInputElement).type] ?? 'textbox',
  SELECT: () => 'combobox',
  TEXTAREA: () => 'textbox',
  IMG: (el) => (el.getAttribute('alt') === '' ? 'presentation' : 'img'),
  NAV: () => 'navigation',
  MAIN: () => 'main',
  HEADER: () => 'banner',
  FOOTER: () => 'contentinfo',
  ASIDE: () => 'complementary',
  FORM: () => 'form',
  UL: () => 'list',
  OL: () => 'list',
  LI: () => 'listitem',
  TABLE: () => 'table',
  DIALOG: () => 'dialog',
  H1: () => 'heading',
  H2: () => 'heading',
  H3: () => 'heading',
  H4: () => 'heading',
  H5: () => 'heading',
  H6: () => 'heading',
}
const small = (s: string | null | undefined, n = 60) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
/** An element's accessible name, as a screen reader would say it (the usual sources). */
function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby')
  if (by) return small(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '))
  const own = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder')
  if (own) return small(own)
  const labels = (el as HTMLInputElement).labels
  if (labels?.[0]) return small(labels[0].textContent)
  return small((el as HTMLElement).innerText)
}
const sides = (s: CSSStyleDeclaration, k: 'margin' | 'padding') => [s.getPropertyValue(`${k}-top`), s.getPropertyValue(`${k}-right`), s.getPropertyValue(`${k}-bottom`), s.getPropertyValue(`${k}-left`)].map((v) => Math.round(parseFloat(v) || 0))
const borders = (s: CSSStyleDeclaration) => ['top', 'right', 'bottom', 'left'].map((k) => Math.round(parseFloat(s.getPropertyValue(`border-${k}-width`)) || 0))
/** Whether the element has text of its own (its contrast matters then). */
const ownText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())

export function elementInfo(el: Element, sig: string): ElementInfo {
  const s = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const info: ElementInfo = {
    tag: el.tagName.toLowerCase(),
    id: el.id,
    classes: [...el.classList].slice(0, 4),
    width: Math.round(r.width * 10) / 10,
    height: Math.round(r.height * 10) / 10,
    color: s.color,
    background: s.backgroundColor,
    margin: sides(s, 'margin'),
    padding: sides(s, 'padding'),
    border: borders(s),
    radius: s.borderRadius,
    display: s.display,
    position: s.position,
    focusable: (el as HTMLElement).tabIndex >= 0,
    children: el.children.length,
    sig,
    matches: safeCount(sig),
  }
  const comp = componentOf(el)
  if (comp) info.component = comp
  if (ownText(el)) {
    info.font = { family: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: s.fontSize, lineHeight: s.lineHeight, weight: s.fontWeight }
    const fg = rgba(s.color)
    if (fg) {
      const bg = backdrop(el)
      const a = lum(over(fg, bg))
      const b = lum(bg)
      const ratio = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100
      const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700)
      info.contrast = { ratio, level: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : large && ratio >= 3 ? 'AA крупный' : 'мало' }
    }
  }
  if (/flex|grid/.test(s.display)) info.layout = s.display.includes('grid') ? `grid · ${s.gridTemplateColumns.split(' ').length} кол. · gap ${s.gap}` : `${s.flexDirection} · ${s.justifyContent} / ${s.alignItems} · gap ${s.gap}`
  if (s.zIndex !== 'auto') info.zIndex = s.zIndex
  if (s.opacity !== '1') info.opacity = s.opacity
  if (s.overflow !== 'visible') info.overflow = s.overflow
  const role = el.getAttribute('role') ?? IMPLICIT_ROLE[el.tagName]?.(el)
  if (role) info.role = role
  const name = nameOf(el)
  if (name) info.name = name
  return info
}
function safeCount(sel: string): number {
  try {
    return document.querySelectorAll(sel).length
  } catch {
    return 0
  }
}

// ---------- the element's framework component (its names live in the page's own world) ----------
/**
 * The page's own world answers «which component is this element» (React's fibers, Vue's instances, Angular, Svelte
 * keep their names there — this world cannot see them): an event asked on the element, answered on the document at
 * once (DOM events cross the worlds; their text detail too).
 */
const BRIDGE = `(() => {
  if (window.__qvarchWho) return
  window.__qvarchWho = true
  const nameOf = (t) => !t || typeof t === 'string' ? '' : t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && nameOf(t.type)) || ''
  const finders = [
    (el) => { for (let x = el; x; x = x.parentElement) { const k = Object.keys(x).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')); if (!k) continue; for (let f = x[k]; f; f = f.return) { const n = (typeof f.type === 'function' || (f.type && typeof f.type === 'object')) && nameOf(f.type); if (n) return 'React · ' + n } } },
    (el) => { for (let x = el; x; x = x.parentElement) { const i = x.__vueParentComponent; if (i && i.type) return 'Vue · ' + (i.type.name || i.type.__name || (i.type.__file || '').split('/').pop() || 'компонент') } },
    (el) => { for (let x = el; x; x = x.parentElement) { const v = x.__vue__; if (v && v.$options) return 'Vue 2 · ' + (v.$options.name || v.$options._componentTag || 'компонент') } },
    (el) => { try { const c = window.ng && (window.ng.getComponent(el) || window.ng.getOwningComponent(el)); if (c) return 'Angular · ' + c.constructor.name } catch (e) {} },
    (el) => { for (let x = el; x; x = x.parentElement) { const m = x.__svelte_meta; if (m && m.loc) return 'Svelte · ' + (m.loc.file || '').split('/').pop() } },
  ]
  document.addEventListener('qvarch-who', (e) => {
    let out = ''
    for (const f of finders) { try { out = f(e.target) || '' } catch (err) {} if (out) break }
    document.dispatchEvent(new CustomEvent('qvarch-who-answer', { detail: out }))
  }, true)
})()`
let bridged = false
let answer = ''
/** The page's world made to answer (once a page). */
export function bridgeComponents(): void {
  if (bridged) return
  bridged = true
  document.addEventListener('qvarch-who-answer', (e) => (answer = String((e as CustomEvent).detail ?? '')), true)
  void webFrame.executeJavaScript(BRIDGE).catch(() => undefined)
}
function componentOf(el: Element): string | undefined {
  if (!bridged) return undefined
  answer = ''
  el.dispatchEvent(new CustomEvent('qvarch-who'))
  return answer || undefined
}
