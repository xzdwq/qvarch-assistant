import { q } from './domText'
import { dialogScope } from './fieldLocators'

/** Locators by the page's structure: steady classes, the path down from a container — the last resort. */

/** Classes that tell a state or are generated — never part of a path. */
const UNSTABLE_CLASS = /^(q-(focus|hover|ripple|transition)|active|focus|hover|selected|v-|ng-|router-link)/
const stableClass = (c: string) => !UNSTABLE_CLASS.test(c) && !/\d{2,}/.test(c)
/** A field one types into (an input / a textarea that takes typing now). */
export const typable = (el: Element) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly && !el.disabled
export const EDITABLE = ':not([readonly]):not([disabled])'

/** A CSS path a person could still read (stable classes; no generated ids). */
export function cssOf(el: Element, root: ParentNode & Node = document): string {
  const parts: string[] = []
  let e: Element | null = el
  while (e && e !== document.body && e !== root && parts.length < 5) {
    if (e.id && !/\d{3,}|^(f_|q-|uid|v-)/i.test(e.id)) {
      parts.unshift(`#${CSS.escape(e.id)}`)
      break
    }
    const cls = [...e.classList].filter(stableClass).slice(0, 2)
    let p = e.tagName.toLowerCase() + cls.map((c) => `.${CSS.escape(c)}`).join('')
    const parent: Element | null = e.parentElement
    if (parent) {
      const same = [...parent.children].filter((k) => k.matches(p))
      if (same.length > 1) p += `:nth-of-type(${[...parent.children].filter((k) => k.tagName === e!.tagName).indexOf(e) + 1})`
    }
    parts.unshift(p)
    if (root.querySelectorAll(parts.join(' > ')).length === 1) break
    e = parent
  }
  return parts.join(' > ')
}
/** An element's kind as CSS: its tag and its steady classes (no state, no generated ones). */
export function sigOf(e: Element): string {
  const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && stableClass(c)).slice(0, 2)
  return e.tagName.toLowerCase() + cls.map((c) => `.${CSS.escape(c)}`).join('')
}
/** The path from a container down to an element, each step a child (its number among its like siblings when not alone). */
export function pathIn(el: Element, root: Element): string | undefined {
  const parts: string[] = []
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) {
    const parent: Element | null = e.parentElement
    if (!parent) return undefined
    let p = sigOf(e)
    if ([...parent.children].filter((k) => k.matches(p)).length > 1) p += `:nth-of-type(${[...parent.children].filter((k) => k.tagName === e!.tagName).indexOf(e) + 1})`
    parts.unshift(p)
  }
  return parts.length ? `:scope > ${parts.join(' > ')}` : undefined
}
/**
 * A CSS path's locator — the last resort, made as steady as it can be: looked for within the element's dialog (not
 * over the page under it); a field typed into — among the fields that take typing only (records shown read-only, more
 * of them as data grows, never shift its number); its number among those when several.
 */
export function cssLocator(el: Element): string {
  const d = dialogScope(el)
  const root = d?.root ?? document
  const c = `${cssOf(el, root)}${typable(el) ? EDITABLE : ''}`
  const all = [...root.querySelectorAll(c)]
  const base = `${d?.code ?? 'page'}.locator(${q(c)})`
  return all.length > 1 && all.includes(el) ? `${base}.nth(${all.indexOf(el)})` : base
}
