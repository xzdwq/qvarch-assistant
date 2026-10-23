/** The recorder's reading of the page: an element's text, role, name, label — and how many elements share them. */

/** A JS string literal in single quotes (for the code a locator is). */
export const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
export const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
export const HIDDEN = 'i.q-icon, .material-icons, .material-symbols-outlined, svg, [aria-hidden="true"], script, style'
/** A regular expression's source matching the text literally. */
export const reSrc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** An element's own visible text, icons left out, one line. */
export function textOf(el: Element, max = 80): string {
  let out = ''
  const walk = (n: Node) => {
    // far longer than any name: no need to read the rest (a whole table)
    if (out.length > max * 4) return
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? ''
    else if (n.nodeType === Node.ELEMENT_NODE) {
      const e = n as Element
      if (e.matches(HIDDEN)) return
      if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) return
      for (const c of e.childNodes) walk(c)
      if (/^(DIV|P|LI|TR|BR|H\d)$/.test(e.tagName)) out += ' '
    }
  }
  walk(el)
  const t = out.replace(/\s+/g, ' ').trim()
  return t.length > max ? '' : t
}
/** The text of an element's own text nodes (not of its children). */
export function ownText(el: Element): string {
  return [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
export const ROLE_OF_TAG: Record<string, string> = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' }
/** Where the elements of a role can be (not every element of the page is looked at). */
export const ROLE_SEL: Record<string, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]',
  link: 'a[href], [role="link"]',
  textbox: 'input, textarea, [role="textbox"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  radio: 'input[type="radio"], [role="radio"]',
  combobox: 'select, [role="combobox"]',
}
export function roleOf(el: Element): string | undefined {
  const r = el.getAttribute('role')
  if (r && !/^(presentation|none|generic|listitem|list)$/.test(r)) return r
  if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) return 'link'
  if (el instanceof HTMLInputElement) return Object.hasOwn(ROLE_OF_INPUT, el.type) ? ROLE_OF_INPUT[el.type] : undefined
  return ROLE_OF_TAG[el.tagName]
}
/** Input types text is typed into. */
export const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'email', 'search', 'tel', 'url', 'number', 'password', ''])
/** Input types that are a flag (checked / not). */
export const CHECKABLE_INPUT_TYPES: ReadonlySet<string> = new Set(['checkbox', 'radio'])
/** An input's type → its role (the other types have none to be found by). */
const ROLE_OF_INPUT: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  ...Object.fromEntries([...TEXT_INPUT_TYPES].map((t) => [t, 'textbox'])),
}
/** Roles named by their label (a field, a flag), not by their text. */
const LABELLED_ROLES: ReadonlySet<string> = new Set(['textbox', 'combobox', 'checkbox', 'radio'])
/** The label of a field: <label for>, a wrapping <label> (Quasar's q-field is one), aria. */
export function labelOf(el: Element): string {
  const a = el.getAttribute('aria-label')
  if (a) return a.trim()
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim()
    if (t) return t
  }
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (l) return textOf(l)
  }
  const wrap = el.closest('label')
  if (wrap) {
    const ql = wrap.querySelector('.q-field__label')
    // a Quasar field without a label of its own: what it shows is its value, not a label
    return ql ? textOf(ql) : wrap.matches('.q-field') ? '' : textOf(wrap)
  }
  return ''
}
export function nameOf(el: Element, role: string): string {
  if (LABELLED_ROLES.has(role)) return labelOf(el)
  const a = el.getAttribute('aria-label')
  if (a) return a.trim()
  if (el instanceof HTMLInputElement) return (el.value || el.title || el.alt || '').trim()
  return textOf(el) || (el.getAttribute('title') ?? '').trim()
}
/** How many visible elements a role / name pair matches the way Playwright does (a part of the name, any case). */
export function countRole(role: string, name: string, exact: boolean): number {
  const n = name.toLowerCase()
  let c = 0
  for (const e of document.querySelectorAll(ROLE_SEL[role] ?? `[role="${role}"]`)) {
    if (roleOf(e) !== role || !visible(e)) continue
    const m = nameOf(e, role).toLowerCase()
    if (exact ? m === n : m.includes(n)) c++
  }
  return c
}
/** An XPath string literal (quotes of both kinds → concat()). */
export const xq = (t: string) => (!t.includes('"') ? `"${t}"` : !t.includes("'") ? `'${t}'` : `concat("${t.split('"').join('", \'"\', "')}")`)
/** How many visible elements have exactly this text (the innermost ones) — the browser's own XPath finds the candidates. */
export function countText(text: string, root: Node = document): number {
  let c = 0
  const r = document.evaluate(`.//*[contains(normalize-space(.), ${xq(text)})]`, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
  for (let i = 0; i < r.snapshotLength && c < 3; i++) {
    const e = r.snapshotItem(i) as Element
    if (e.matches(HIDDEN) || !visible(e) || textOf(e) !== text) continue
    if ([...e.children].some((k) => textOf(k) === text)) continue
    c++
  }
  return c
}
/** How many fields a block holds: a Quasar field is one, with the input inside it (not two). */
export const fieldsIn = (root: Element) => [...root.querySelectorAll('.q-field, input, textarea, select')].filter((x) => x.matches('.q-field') || !x.parentElement?.closest('.q-field')).length
/** An element holding exactly this text (as Playwright's getByText exact: the whole text, any spaces). */
export const hasExact = (root: Element, text: string) => [root, ...root.querySelectorAll('*')].some((e) => !e.matches(HIDDEN) && textOf(e, 200) === text)
