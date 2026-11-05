import { selectorOf, UI } from '../../shared/browser/uiKits'
import { cssLocator } from './cssPath'
import { countRole, countText, labelOf, nameOf, q, reSrc, roleOf, textOf, visible } from './domText'
import { fieldLocator, rowFieldLocator, rowLocator, scopeOf } from './fieldLocators'
import { anchoredLocator, testIdHolder, testIdLocator } from './testIdLocators'

/** The locator for an element, as code: the steadiest way to find it again, tried in order. */

/**
 * A field that opens a list (a select with a search box): the field by its label (its kit's wrapper; onField) — else the
 * input itself; the check of the option picked follows what it points at.
 */
export function listFieldLocator(el: Element): { loc: string; onField: boolean } {
  // its test id first: the field holding it (clicked — its list opens), or the input itself
  const h = testIdHolder(el)
  const tid = h && testIdLocator(h.holder)
  if (tid) return { loc: tid.loc, onField: tid.holder !== el }
  const f = fieldLocator(el) ?? rowFieldLocator(el)
  return { loc: f ?? locatorFor(el), onField: !!f }
}
/** The locator for an element, as code (never fails: the last resort is its CSS path). */
export function locatorFor(el: Element): string {
  try {
    return locatorOf(el)
  } catch {
    return cssLocator(el)
  }
}
function locatorOf(el: Element): string {
  const tid = testIdLocator(el)
  if (tid) return tid.loc
  const role = roleOf(el)
  if (role) {
    const name = nameOf(el, role)
    if (name) {
      if (countRole(role, name, false) === 1) return `page.getByRole(${q(role)}, { name: ${q(name)} })`
      if (countRole(role, name, true) === 1) return `page.getByRole(${q(role)}, { name: ${q(name)}, exact: true })`
    }
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const ph = el.placeholder?.trim()
    if (ph && document.querySelectorAll(`[placeholder="${CSS.escape(ph)}"]`).length === 1) return `page.getByPlaceholder(${q(ph)})`
    const lab = labelOf(el)
    if (lab) return `page.getByLabel(${q(lab)})`
  }
  const field = fieldLocator(el) ?? rowFieldLocator(el)
  if (field) return field
  const row = el.closest('tr')
  if (row instanceof HTMLTableRowElement && !el.closest(`a, input, select, textarea, ${UI.button}, ${UI.check}`)) {
    const r = rowLocator(row)
    if (r) return r
  }
  const text = textOf(el, 60)
  if (text) {
    if (countText(text) === 1) return `page.getByText(${q(text)}, { exact: true })`
    const sc = scopeOf(el)
    if (sc && countText(text, sc.root) === 1) return `${sc.code}.getByText(${q(text)}, { exact: true })`
  }
  return iconButtonLocator(el) ?? anchoredLocator(el) ?? cssLocator(el)
}
/**
 * An icon-only button: its icon's name — in its row / dialog / menu, and its number there when not alone (never «the
 * first on the page»: another layout puts another one first); the icon itself clicked (a bare <i> in a clickable
 * span) — the same. No icon — none (the caller goes on: by its record, the CSS path the very last resort).
 */
function iconButtonLocator(el: Element): string | undefined {
  const iconIn = (e: Element) => (e.matches(UI.icon) ? e : e.querySelector(UI.icon))
  const iname = iconIn(el)?.textContent?.trim()
  if (!iname) return undefined
  const btn = el.closest(UI.button) ?? el
  // several alike and no row to tell them: by the record it is in
  const same0 = [...document.querySelectorAll(`${UI.button}, ${UI.icon}`)].filter((b) => visible(b) && iconIn(b)?.textContent?.trim() === iname)
  if (same0.length > 1 && !el.closest(`tr, ${UI.dialog}`)) {
    const a = anchoredLocator(btn)
    if (a) return a
  }
  let scope: { code: string; root: Element } | undefined
  const row = el.closest('tr')
  if (row instanceof HTMLTableRowElement) {
    const r = rowLocator(row)
    if (r) scope = { code: r, root: row }
  }
  scope ??= scopeOf(el)
  // (the buttons of the kit there — counted by the very selector written)
  const btnSel = selectorOf(btn, 'button')
  const base = `${scope ? scope.code : 'page'}.locator(${q(btnSel)}).filter({ has: page.locator('i', { hasText: /^${reSrc(iname)}$/ }) })`
  const same = [...(scope?.root ?? document).querySelectorAll(btnSel)].filter((b) => visible(b) && b.querySelector(UI.icon)?.textContent?.trim() === iname)
  const i = same.indexOf(btn)
  return same.length > 1 && i >= 0 ? `${base}.nth(${i})` : base
}
