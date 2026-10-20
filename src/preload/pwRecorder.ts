/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Recording a Playwright scenario in the app's browser: clicks, typing, Enter / Escape, choices in lists — each
 * as a line of Playwright code with a locator a person would write (test id → role and name → placeholder /
 * label → text, narrowed to a menu / a dialog when not unique → CSS). Quasar's icon ligatures (aria-hidden) are
 * not names. Passwords are never written down. The lines go to the app; it puts them into the note's block.
 */
/** A line; `replace` — the same click just written (twice: a double click) goes, this one stands for it. */
type Act = { code: string; note?: string; replace?: string }
let on = false
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
const HIDDEN = 'i.q-icon, .material-icons, .material-symbols-outlined, svg, [aria-hidden="true"], script, style'

/** An element's own visible text, icons left out, one line. */
function textOf(el: Element, max = 80): string {
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
const ROLE_OF_TAG: Record<string, string> = { BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' }
/** Where the elements of a role can be (not every element of the page is looked at). */
const ROLE_SEL: Record<string, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]',
  link: 'a[href], [role="link"]',
  textbox: 'input, textarea, [role="textbox"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"]',
  radio: 'input[type="radio"], [role="radio"]',
  combobox: 'select, [role="combobox"]',
}
function roleOf(el: Element): string | undefined {
  const r = el.getAttribute('role')
  if (r && !/^(presentation|none|generic|listitem|list)$/.test(r)) return r
  if (el instanceof HTMLAnchorElement && el.hasAttribute('href')) return 'link'
  if (el instanceof HTMLInputElement) {
    const t = el.type
    if (/^(button|submit|reset|image)$/.test(t)) return 'button'
    if (t === 'checkbox') return 'checkbox'
    if (t === 'radio') return 'radio'
    if (/^(text|email|search|tel|url|number|password|)$/.test(t)) return 'textbox'
    return undefined
  }
  return ROLE_OF_TAG[el.tagName]
}
/** The label of a field: <label for>, a wrapping <label> (Quasar's q-field is one), aria. */
function labelOf(el: Element): string {
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
    return ql ? textOf(ql) : textOf(wrap)
  }
  return ''
}
function nameOf(el: Element, role: string): string {
  if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio') return labelOf(el)
  const a = el.getAttribute('aria-label')
  if (a) return a.trim()
  if (el instanceof HTMLInputElement) return (el.value || el.title || el.alt || '').trim()
  return textOf(el) || (el.getAttribute('title') ?? '').trim()
}
/** How many visible elements a role / name pair matches the way Playwright does (a part of the name, any case). */
function countRole(role: string, name: string, exact: boolean): number {
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
const xq = (t: string) => (!t.includes('"') ? `"${t}"` : !t.includes("'") ? `'${t}'` : `concat("${t.split('"').join('", \'"\', "')}")`)
/** How many visible elements have exactly this text (the innermost ones) — the browser's own XPath finds the candidates. */
function countText(text: string, root: Node = document): number {
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
/** A Quasar field (q-input / q-select): by its label — its value changes, its label does not. */
function fieldLocator(el: Element): string | undefined {
  const fld = el.closest('.q-field')
  const lab = fld?.querySelector('.q-field__label')
  // the label's own words (a badge in it — «Изменено», a star — is not the label)
  const t = lab ? ownText(lab) || textOf(lab, 60) : ''
  if (!fld || !t) return undefined
  const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const labels = [...document.querySelectorAll('.q-field')].filter(visible).map((x) => {
    const l = x.querySelector('.q-field__label')
    return { x, t: l ? textOf(l, 80) : '' }
  })
  // «Статус …» — the label starting with it (a badge after it later changes nothing), unless another field's starts so too
  const starts = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `))
  const re = starts.length <= 1 ? `/^\\s*${esc}(\\s|$)/` : `/^\\s*${esc}\\s*$/`
  if (starts.length <= 1) return `page.locator('.q-field', { has: page.locator('.q-field__label', { hasText: ${re} }) })`
  // another label starts so too («Статус оплаты»): the label's own first words exactly (a badge after them is no matter)
  const cls = (c: string) => `contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')`
  const xp = `//*[${cls('q-field')}][.//*[${cls('q-field__label')}][normalize-space(text()[1])=${xq(t)}]]`
  const same = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `)).map((l) => l.x).filter((x) => ownText(x.querySelector('.q-field__label')!) === t)
  const base = `page.locator(${q(`xpath=${xp}`)})`
  return same.length > 1 ? `${base}.nth(${Math.max(0, same.indexOf(fld))})` : base
}
/** The text of an element's own text nodes (not of its children). */
function ownText(el: Element): string {
  return [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
/** A row of a table: by its most telling cell (unique among the rows), else by its number. */
function rowLocator(row: HTMLTableRowElement): string | undefined {
  const body = row.closest('tbody')
  if (!body) return undefined
  const rows = [...body.querySelectorAll('tr')]
  for (const cell of row.querySelectorAll('td, th')) {
    const t = textOf(cell, 60)
    if (!t || t.length < 2) continue
    if (rows.filter((r) => (r.textContent ?? '').includes(t)).length === 1) return `page.locator('tbody tr', { hasText: ${q(t)} })`
  }
  return `page.locator('tbody tr').nth(${rows.indexOf(row)})`
}
const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa']
/** What a scope around the element could be (a dialog, a menu), as a locator and its root. */
function scopeOf(el: Element): { code: string; root: Element } | undefined {
  const menu = el.closest('.q-menu, [role="menu"], [role="listbox"]')
  if (menu && document.querySelectorAll('.q-menu, [role="menu"], [role="listbox"]').length >= 1) return { code: `page.locator(${q(menu.matches('.q-menu') ? '.q-menu' : `[role="${menu.getAttribute('role')}"]`)})`, root: menu }
  const dlg = el.closest('.q-dialog, [role="dialog"], dialog')
  if (dlg) {
    const title = dlg.querySelector('.q-card__section .text-h6, .v-card-title, [class*="title"], h1, h2, h3')
    const t = title ? textOf(title, 60) : ''
    if (t) return { code: `page.locator('.q-dialog, [role="dialog"]').filter({ hasText: ${q(t)} })`, root: dlg }
  }
  return undefined
}
/** A CSS path a person could still read (stable classes; no generated ids). */
function cssOf(el: Element): string {
  const parts: string[] = []
  let e: Element | null = el
  while (e && e !== document.body && parts.length < 5) {
    if (e.id && !/\d{3,}|^(f_|q-|uid|v-)/i.test(e.id)) {
      parts.unshift(`#${CSS.escape(e.id)}`)
      break
    }
    const cls = [...e.classList].filter((c) => !/^(q-(focus|hover|ripple|transition)|active|focus|hover|selected|v-|ng-|router-link)/.test(c) && !/\d{2,}/.test(c)).slice(0, 2)
    let p = e.tagName.toLowerCase() + cls.map((c) => `.${CSS.escape(c)}`).join('')
    const parent: Element | null = e.parentElement
    if (parent) {
      const same = [...parent.children].filter((k) => k.matches(p))
      if (same.length > 1) p += `:nth-of-type(${[...parent.children].filter((k) => k.tagName === e!.tagName).indexOf(e) + 1})`
    }
    parts.unshift(p)
    if (document.querySelectorAll(parts.join(' > ')).length === 1) break
    e = parent
  }
  return parts.join(' > ')
}
/** The locator for an element, as code (never fails: the last resort is its CSS path). */
function locatorFor(el: Element): string {
  try {
    return locatorOf(el)
  } catch {
    return `page.locator(${q(cssOf(el))})`
  }
}
function locatorOf(el: Element): string {
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a)
    if (v && document.querySelectorAll(`[${a}="${CSS.escape(v)}"]`).length === 1) return a === 'data-testid' ? `page.getByTestId(${q(v)})` : `page.locator(${q(`[${a}="${v}"]`)})`
  }
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
  const field = fieldLocator(el)
  if (field) return field
  const row = el.closest('tr')
  if (row instanceof HTMLTableRowElement && !el.closest('button, a, input, select, textarea, [role="button"], .q-btn, .q-checkbox, .q-toggle')) {
    const r = rowLocator(row)
    if (r) return r
  }
  const text = textOf(el, 60)
  if (text) {
    if (countText(text) === 1) return `page.getByText(${q(text)}, { exact: true })`
    const sc = scopeOf(el)
    if (sc && countText(text, sc.root) === 1) return `${sc.code}.getByText(${q(text)}, { exact: true })`
  }
  // an icon-only button: its icon's name
  const icon = el.querySelector('i.q-icon, .material-icons')
  if (icon?.textContent?.trim()) {
    const sc = scopeOf(el)
    const base = `${sc ? sc.code : 'page'}.locator('.q-btn, button').filter({ has: page.locator('i', { hasText: /^${icon.textContent.trim().replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/ }) })`
    return `${base}.first()`
  }
  return `page.locator(${q(cssOf(el))})`
}

const CLICKABLE = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], .q-item, .q-btn, .q-chip, .q-tab, .q-checkbox, .q-radio, .q-toggle, [onclick], [tabindex]'
const targetOf = (e: Event) => ((e.target as Element)?.closest?.(CLICKABLE) ?? (e.target as Element)) as Element

// typing: one fill() per field, written when the next thing happens
let typing: { el: HTMLInputElement | HTMLTextAreaElement; loc: string } | undefined
function flush(): void {
  const t = typing
  typing = undefined
  if (!t) return
  if (t.el instanceof HTMLInputElement && t.el.type === 'password') send({ code: `await ${t.loc}.fill('') // пароль не записывается — подставьте сами`, note: 'пароль' })
  else send({ code: `await ${t.loc}.fill(${q(t.el.value)})` })
}
function send(a: Act): void {
  ipcRenderer.send('qa:pwrec-act', a)
  flashBadge()
}

let lastField: string | undefined
function onClick(e: MouseEvent): void {
  if (!on || !e.isTrusted || (e.target as Element)?.closest?.('#qa-pwrec')) return
  const el = targetOf(e)
  // the page itself (an empty spot): nothing to repeat
  if (el === document.documentElement || el === document.body) return
  if (el instanceof HTMLInputElement && /^(text|email|search|tel|url|number|password|)$/.test(el.type)) return
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
  if (typing && typing.el !== el) flush()
  const loc = locatorFor(el)
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) send({ code: `await ${loc}.${el.checked ? 'check' : 'uncheck'}()` })
  else send({ code: `await ${loc}.click()` })
  // a field opened: remembered; one of its options picked — the field must show it before the next step
  if (el.closest('.q-field')) lastField = fieldLocator(el)
  else if (lastField && el.closest('.q-menu, [role="listbox"]') && (el.getAttribute('role') === 'option' || el.matches('.q-item'))) {
    const opt = textOf(el, 60)
    if (opt) send({ code: `await expect(${lastField}).toContainText(${q(opt)})` })
    lastField = undefined
  }
}
function onDbl(e: MouseEvent): void {
  if (!on || !e.isTrusted || (e.target as Element)?.closest?.('#qa-pwrec')) return
  const el = targetOf(e)
  if (el === document.documentElement || el === document.body) return
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
  const loc = locatorFor(el)
  send({ code: `await ${loc}.dblclick()`, replace: `await ${loc}.click()` })
}
function onInput(e: Event): void {
  if (!on || !e.isTrusted) return
  const el = e.target as HTMLInputElement | HTMLTextAreaElement
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return
  if (el instanceof HTMLInputElement && /^(checkbox|radio|file|range|color)$/.test(el.type)) return
  if (typing?.el !== el) {
    flush()
    typing = { el, loc: locatorFor(el) }
  }
}
function onChange(e: Event): void {
  if (!on || !e.isTrusted) return
  const el = e.target as Element
  if (el instanceof HTMLSelectElement) {
    flush()
    send({ code: `await ${locatorFor(el)}.selectOption(${q(el.value)})` })
  } else if (typing?.el === el) flush()
}
function onKey(e: KeyboardEvent): void {
  if (!on || !e.isTrusted || !['Enter', 'Escape', 'Tab'].includes(e.key)) return
  const el = e.target as Element
  const loc = typing?.el === el ? typing.loc : el && el !== document.body ? locatorFor(el) : undefined
  flush()
  if (e.key === 'Tab') return
  send({ code: loc ? `await ${loc}.press(${q(e.key)})` : `await page.keyboard.press(${q(e.key)})` })
}

// ---------- what the page shows while recording: the element under the pointer, a badge ----------
let box: HTMLDivElement | undefined
let badge: HTMLDivElement | undefined
let count = 0
function ui(show: boolean): void {
  box?.remove()
  badge?.remove()
  box = badge = undefined
  if (!show) return
  box = document.createElement('div')
  box.id = 'qa-pwrec'
  box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #ef4444;border-radius:3px;background:rgba(239,68,68,.08);display:none'
  badge = document.createElement('div')
  badge.id = 'qa-pwrec'
  badge.style.cssText = 'position:fixed;z-index:2147483647;right:10px;bottom:10px;padding:5px 10px;border-radius:14px;background:#ef4444;color:#fff;font:600 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none'
  badge.textContent = '● Запись'
  document.documentElement.append(box, badge)
}
function flashBadge(): void {
  count++
  if (badge) badge.textContent = `● Запись · ${count}`
}
function onOver(e: MouseEvent): void {
  if (!on || !box) return
  const el = targetOf(e)
  const r = el.getBoundingClientRect()
  Object.assign(box.style, { display: 'block', left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` })
  box.title = ''
}
function set(v: boolean): void {
  if (v === on) return
  if (!v) flush()
  on = v
  if (document.documentElement) ui(v)
}
document.addEventListener('click', onClick, true)
document.addEventListener('dblclick', onDbl, true)
document.addEventListener('input', onInput, true)
document.addEventListener('change', onChange, true)
document.addEventListener('keydown', onKey, true)
document.addEventListener('mouseover', onOver, true)
window.addEventListener('blur', flush)
window.addEventListener('beforeunload', flush)
ipcRenderer.on('qa:pwrec', (_e, v: boolean) => set(!!v))
// «Стоп» pressed: the typing not written yet goes now
ipcRenderer.on('qa:pwrec-flush', () => flush())
window.addEventListener('DOMContentLoaded', () => {
  void ipcRenderer.invoke('qa:pwrec-get').then((v: { on: boolean; count: number } | null) => {
    if (!v?.on) return
    // a new page while recording: the badge goes on with the count so far
    set(true)
    count = v.count
    if (badge) badge.textContent = count ? `● Запись · ${count}` : '● Запись'
  })
})
