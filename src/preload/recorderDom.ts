/**
 * The recorder's DOM side: how an element is found again (a locator Playwright runs) and said in words (a step) —
 * no events, no IPC: the recording (pwRecorder.ts) uses it, the tests run it in a real page against fixtures.
 */

export const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
export const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
export const HIDDEN = 'i.q-icon, .material-icons, .material-symbols-outlined, svg, [aria-hidden="true"], script, style'

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
  if (role === 'textbox' || role === 'combobox' || role === 'checkbox' || role === 'radio') return labelOf(el)
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
/** A Quasar field (q-input / q-select): by its label — its value changes, its label does not. */
export function fieldLocator(el: Element): string | undefined {
  const fld = el.closest('.q-field')
  const lab = fld?.querySelector('.q-field__label')
  // the label's own words (a badge in it — «Изменено», a star — is not the label)
  const t = lab ? ownText(lab) || textOf(lab, 60) : ''
  if (!fld || !t) return undefined
  const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  // (the field's dialog its scope — the fields of the page under it are not counted)
  const d = dialogScope(el)
  const at = d?.code ?? 'page'
  const labels = [...(d?.root ?? document).querySelectorAll('.q-field')].filter(visible).map((x) => {
    const l = x.querySelector('.q-field__label')
    return { x, t: l ? textOf(l, 80) : '' }
  })
  // «Статус …» — the label starting with it (a badge after it later changes nothing), unless another field's starts so too
  const starts = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `))
  const re = starts.length <= 1 ? `/^\\s*${esc}(\\s|$)/` : `/^\\s*${esc}\\s*$/`
  if (starts.length <= 1) return `${at}.locator('.q-field', { has: page.locator('.q-field__label', { hasText: ${re} }) })`
  // another label starts so too («Статус оплаты»): the label's own first words exactly (a badge after them is no matter)
  const cls = (c: string) => `contains(concat(' ', normalize-space(@class), ' '), ' ${c} ')`
  const xp = `${d ? './/' : '//'}*[${cls('q-field')}][.//*[${cls('q-field__label')}][normalize-space(text()[1])=${xq(t)}]]`
  const same = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `)).map((l) => l.x).filter((x) => ownText(x.querySelector('.q-field__label')!) === t)
  const base = `${at}.locator(${q(`xpath=${xp}`)})`
  return same.length > 1 ? `${base}.nth(${Math.max(0, same.indexOf(fld))})` : base
}
/**
 * A field's label beside it (a form row «Категория [ поле ]» — the label outside the field): the nearest
 * text before the field within its row, a few levels up; a row holding another field is not its row.
 */
export function rowLabelOf(el: Element): { text: string; raw: string; row: Element } | undefined {
  let branch: Element = el.closest('.q-field') ?? el
  for (let up = 0; up < 4 && branch.parentElement && branch.parentElement !== document.body; up++) {
    const row = branch.parentElement
    if (row.matches('form, .q-dialog, [role="dialog"], table, tbody, thead')) return undefined
    for (let p = branch.previousElementSibling; p; p = p.previousElementSibling) {
      if (p.matches('.q-field, input, textarea, select') || p.querySelector('.q-field, input, textarea, select')) return undefined
      const t = textOf(p, 60)
      if (t && t.length >= 2) return { text: t.replace(/[:*]\s*$/, '').trim(), raw: t, row }
    }
    if (fieldsIn(row) > 1) return undefined
    branch = row
  }
  return undefined
}
/** How many fields a block holds: a Quasar field is one, with the input inside it (not two). */
export const fieldsIn = (root: Element) => [...root.querySelectorAll('.q-field, input, textarea, select')].filter((x) => x.matches('.q-field') || !x.parentElement?.closest('.q-field')).length
/** An element holding exactly this text (as Playwright's getByText exact: the whole text, any spaces). */
export const hasExact = (root: Element, text: string) => [root, ...root.querySelectorAll('*')].some((e) => !e.matches(HIDDEN) && textOf(e, 200) === text)
/**
 * A field by its row's label, exactly («Наименование» is not «Полное наименование»): the rows (by their classes)
 * holding that very text → the one of ours (its number when several) → its field (its number in the row).
 */
export function rowFieldLocator(el: Element): string | undefined {
  const r = rowLabelOf(el)
  if (!r) return undefined
  const cls = [...r.row.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/\d{2,}|active|focus|hover/.test(c)).slice(0, 3)
  const sel = r.row.tagName.toLowerCase() + cls.map((c) => `.${c}`).join('')
  const FIELDS = '.q-field, input, textarea, select'
  // looked for where the field is: its dialog (by the dialog's title) — not over the whole page, where a table under
  // the dialog may have the same words in its header and a number counted at recording means nothing at a replay
  const d = dialogScope(el)
  const rows = [...(d?.root ?? document).querySelectorAll(sel)].filter((x) => visible(x) && hasExact(x, r.raw) && x.querySelector(FIELDS))
  const k = rows.indexOf(r.row)
  if (k < 0) return undefined
  const inner = el.closest('.q-field') ? '.q-field' : 'input, textarea, select'
  const fields = [...r.row.querySelectorAll(inner)]
  const i = Math.max(0, fields.indexOf(el.closest('.q-field') ?? el))
  return `${d?.code ?? 'page'}.locator(${q(sel)}).filter({ has: page.getByText(${q(r.raw)}, { exact: true }) })${rows.length > 1 ? `.nth(${k})` : ''}.locator(${q(inner)})${fields.length > 1 ? `.nth(${i})` : ''}`
}
/** The dialog an element is in, by its title: a locator to look inside it, and its element. */
export function dialogScope(el: Element): { code: string; root: Element } | undefined {
  const dlg = el.closest('.q-dialog, [role="dialog"], dialog')
  const title = dlg?.querySelector('.q-card__section .text-h6, .v-card-title, [class*="title"], h1, h2, h3')
  const t = title ? textOf(title, 60) : ''
  return dlg && t ? { code: `page.locator('.q-dialog, [role="dialog"], dialog').filter({ hasText: ${q(t)} })`, root: dlg } : undefined
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
/** A row of a table: by its most telling cell (unique among the rows), else by its number. */
export function rowLocator(row: HTMLTableRowElement): string | undefined {
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
export const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa']
/** What a scope around the element could be (a dialog, a menu), as a locator and its root. */
export function scopeOf(el: Element): { code: string; root: Element } | undefined {
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
export function cssOf(el: Element, root: ParentNode & Node = document): string {
  const parts: string[] = []
  let e: Element | null = el
  while (e && e !== document.body && e !== root && parts.length < 5) {
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
    if (root.querySelectorAll(parts.join(' > ')).length === 1) break
    e = parent
  }
  return parts.join(' > ')
}
/**
 * A field that opens a list (a select with a search box): the field by its label (its .q-field; onField) — else the
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
/** A field one types into (an input / a textarea that takes typing now). */
const typable = (el: Element) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.readOnly && !el.disabled
const EDITABLE = ':not([readonly]):not([disabled])'
/** An element's kind as CSS: its tag and its steady classes (no state, no generated ones). */
function sigOf(e: Element): string {
  const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/^(q-(focus|hover|ripple|transition)|active|focus|hover|selected|v-|ng-|router-link)/.test(c) && !/\d{2,}/.test(c)).slice(0, 2)
  return e.tagName.toLowerCase() + cls.map((c) => `.${CSS.escape(c)}`).join('')
}
/** The path from a container down to an element, each step a child (its number among its like siblings when not alone). */
function pathIn(el: Element, root: Element): string | undefined {
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
/** A text of a container's own (a leaf's: a record's code, its name) — the words that tell it from its likes. */
function textsIn(c: Element, not: Element): string[] {
  const out: string[] = []
  for (const e of c.querySelectorAll('*')) {
    if (out.length >= 12 || e.children.length || e.matches(HIDDEN) || not.contains(e) || !visible(e)) continue
    const t = textOf(e, 60)
    if (t.length >= 2 && !/^\d{1,3}$/.test(t) && !out.includes(t)) out.push(t)
  }
  return out
}
/**
 * An element with nothing of its own to be found by (no label, no words — a field of a record, an icon) found by its
 * record: the nearest container repeated on the page (records, rows, cards alike) told from its likes by its own words
 * (a saved record's code / name), or by being the one that is edited (fields one can type into, the others read-only);
 * then the element by its place inside that record. Never «the Nth on the page»: more records, and the Nth is another.
 */
export function anchoredLocator(el: Element, within?: (c: Element) => string | undefined): string | undefined {
  let depth = 0
  for (let c = el.parentElement; c && c !== document.body && depth < 10; c = c.parentElement, depth++) {
    const sig = sigOf(c)
    const peers = [...document.querySelectorAll(sig)].filter(visible)
    if (peers.length < 2 || !peers.includes(c)) continue
    // the element inside the record: as one asked (its test id), else by its place there
    let tail = within?.(c)
    if (!within) {
      const rel = pathIn(el, c)
      if (rel && c.querySelectorAll(rel).length === 1) tail = `.locator(${q(rel)})`
    }
    if (!tail) continue
    const inner = (anchor: string) => `${anchor}${tail}`
    // its own words
    for (const t of textsIn(c, el)) {
      const holders = peers.filter((p) => [...p.querySelectorAll('*')].some((e) => !e.children.length && textOf(e, 60) === t))
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: page.getByText(${q(t)}, { exact: true }) })`)
    }
    // the one edited: fields one types into at the same place, the likes having none
    const ed = [...c.querySelectorAll('input, textarea')].find(typable)
    // (that field by its test id when it has one)
    const et = ed && testIdHolder(ed)
    if (et && et.attr === 'data-testid') {
      const { stem, numbered } = testIdOf(et.value)
      const kin = (p: Element) => [...p.querySelectorAll(`[data-testid^="${CSS.escape(stem)}"]`)].filter((e) => (numbered ? testIdOf(e.getAttribute('data-testid')!).stem === stem : e.getAttribute('data-testid') === et.value))
      const holders = peers.filter((p) => kin(p).some((h) => [...h.querySelectorAll('input, textarea'), h].some(typable)))
      const code = `page.getByTestId(${numbered ? `/^${reSrc(stem)}[-_]\\d+$/` : q(et.value)}).locator(${q(`input${EDITABLE}, textarea${EDITABLE}`)})`
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: ${code} })`)
    }
    const edRel = ed && pathIn(ed, c)
    if (edRel) {
      const sel = `${edRel}${EDITABLE}`
      const holders = peers.filter((p) => p.querySelector(sel))
      if (holders.length === 1 && holders[0] === c) return inner(`page.locator(${q(sig)}).filter({ has: page.locator(${q(sel)}) })`)
    }
  }
  return undefined
}
/** Controls a test id's holder may hold besides the element (more than one — the id is a block's, not the element's). */
const CONTROLS = 'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"], [role="combobox"]'
/**
 * A test id: its stem and whether it is numbered — «uom-3» (a list's v-for gives each its index: «uom», numbered),
 * «uom» (plain). The number is never kept: more records before it, and «uom-3» is another one's.
 */
export function testIdOf(v: string): { stem: string; numbered: boolean } {
  const m = /^(.*[^\d_-])[-_]\d+$/.exec(v)
  return m ? { stem: m[1], numbered: true } : { stem: v, numbered: false }
}
const reSrc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
/** The test id for the element: on itself, or on its field / button (the holder holding no other control). */
function testIdHolder(el: Element): { holder: Element; attr: string; value: string } | undefined {
  for (let e: Element | null = el, d = 0; e && e !== document.body && d < 6; e = e.parentElement, d++)
    for (const attr of TEST_ATTRS) {
      const value = e.getAttribute(attr)
      if (!value) continue
      if (e !== el && e.querySelectorAll(CONTROLS).length > 1) return undefined
      return { holder: e, attr, value }
    }
  return undefined
}
/**
 * The element by its test id — first of all: an id is what the app's authors gave it to be found by. A numbered one
 * (a v-for's «uom-1») — every «uom-N», then the record it is in (anchoredLocator: its own words, the one edited);
 * a plain one met more than once — the same. A typing's input inside its field: the field's input.
 */
export function testIdLocator(el: Element): { loc: string; holder: Element } | undefined {
  const t = testIdHolder(el)
  if (!t) return undefined
  const { holder, attr, value } = t
  const { stem, numbered } = testIdOf(value)
  const kinOf = (v: string | null) => !!v && (numbered ? testIdOf(v).numbered && testIdOf(v).stem === stem : v === value)
  const kinSel = numbered ? `[${attr}^="${CSS.escape(stem)}"]` : `[${attr}="${CSS.escape(value)}"]`
  const kinIn = (root: ParentNode) => [...root.querySelectorAll(kinSel)].filter((e) => kinOf(e.getAttribute(attr)))
  // the kin as code: data-testid by Playwright's own getByTestId (a pattern for a numbered one), others by CSS
  const pattern = `/^${reSrc(stem)}[-_]\\d+$/`
  const kinCode = (on: string) => (attr === 'data-testid' ? `${on}getByTestId(${numbered ? pattern : q(value)})` : `${on}locator(${q(kinSel)})`)
  // (another attribute numbered — a CSS prefix: only when all it catches are kin)
  if (numbered && attr !== 'data-testid' && document.querySelectorAll(kinSel).length !== kinIn(document).length) return undefined
  const all = kinIn(document).filter(visible)
  let loc: string | undefined
  if (all.length <= 1) loc = kinCode('page.')
  else {
    loc = anchoredLocator(holder, (c) => (kinIn(c).length === 1 ? kinCode('.') : undefined))
    // no record tells it: the id as it is, when it alone has it
    if (!loc && document.querySelectorAll(`[${attr}="${CSS.escape(value)}"]`).length === 1) loc = attr === 'data-testid' ? `page.getByTestId(${q(value)})` : `page.locator(${q(`[${attr}="${value}"]`)})`
  }
  if (!loc) return undefined
  if (holder !== el && (el.matches('input, textarea') || el.matches('[contenteditable="true"]'))) loc += `.locator(${q('input:not([type="hidden"]), textarea, [contenteditable="true"]')})`
  return { loc, holder }
}
/**
 * A CSS path's locator — the last resort, made as steady as it can be: looked for within the element's dialog (not
 * over the page under it); a field typed into — among the fields that take typing only (records shown read-only, more
 * of them as data grows, never shift its number); its number among those when several.
 */
export function cssLocator(el: Element): string {
  const d = dialogScope(el)
  const root = d?.root ?? document
  const c = `${cssOf(el, root)}${typable(el) ? ':not([readonly]):not([disabled])' : ''}`
  const all = [...root.querySelectorAll(c)]
  const base = `${d?.code ?? 'page'}.locator(${q(c)})`
  return all.length > 1 && all.includes(el) ? `${base}.nth(${all.indexOf(el)})` : base
}
/** The locator for an element, as code (never fails: the last resort is its CSS path). */
export function locatorFor(el: Element): string {
  try {
    return locatorOf(el)
  } catch {
    return cssLocator(el)
  }
}
export function locatorOf(el: Element): string {
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
  // an icon-only button: its icon's name — in its row / dialog / menu, and its number there when not alone
  // (never «the first on the page»: another layout puts another one first); the icon itself clicked (a bare <i> in a
  // clickable span) — the same
  const icon = el.matches('i.q-icon, .material-icons') ? el : el.querySelector('i.q-icon, .material-icons')
  const iname = icon?.textContent?.trim()
  if (iname) {
    const btn = el.closest('.q-btn, button') ?? el
    // several alike and no row to tell them: by the record it is in
    const same0 = [...document.querySelectorAll('.q-btn, button, i.q-icon, .material-icons')].filter((b) => visible(b) && (b.matches('i') ? b : b.querySelector('i.q-icon, .material-icons'))?.textContent?.trim() === iname)
    if (same0.length > 1 && !el.closest('tr, .q-dialog, [role="dialog"], dialog')) {
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
    const base = `${scope ? scope.code : 'page'}.locator('.q-btn, button').filter({ has: page.locator('i', { hasText: /^${iname.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$/ }) })`
    const same = [...(scope?.root ?? document).querySelectorAll('.q-btn, button')].filter((b) => visible(b) && b.querySelector('i.q-icon, .material-icons')?.textContent?.trim() === iname)
    const i = same.indexOf(btn)
    return same.length > 1 && i >= 0 ? `${base}.nth(${i})` : base
  }
  // nothing of its own: by its record; the CSS path — the very last resort
  return anchoredLocator(el) ?? cssLocator(el)
}

// ---------- a step in words (written at once, while the page is there: the element's kind, name, place) ----------
/** Material icons' names (Quasar, Vuetify…) in words — what the button does. */
export const ICON_WORDS: Record<string, string> = {
  edit: 'Изменить', mode_edit: 'Изменить', edit_note: 'Изменить', create: 'Изменить', content_copy: 'Копировать', copy_all: 'Копировать', file_copy: 'Копировать',
  delete: 'Удалить', delete_outline: 'Удалить', delete_forever: 'Удалить', remove: 'Убрать', remove_circle: 'Убрать', close: 'Закрыть', clear: 'Очистить', cancel: 'Отменить',
  add: 'Добавить', add_circle: 'Добавить', add_circle_outline: 'Добавить', add_box: 'Добавить', playlist_add: 'Добавить', save: 'Сохранить', check: 'Подтвердить', done: 'Готово', done_all: 'Готово',
  search: 'Искать', more_vert: 'Ещё', more_horiz: 'Ещё', menu: 'Меню', expand_more: 'Раскрыть', expand_less: 'Свернуть', keyboard_arrow_down: 'Раскрыть', keyboard_arrow_up: 'Свернуть', arrow_drop_down: 'Раскрыть',
  chevron_right: 'Вперёд', chevron_left: 'Назад', arrow_back: 'Назад', arrow_forward: 'Вперёд', first_page: 'В начало', last_page: 'В конец', refresh: 'Обновить', sync: 'Обновить', autorenew: 'Обновить',
  filter_list: 'Фильтр', filter_alt: 'Фильтр', filter_alt_off: 'Сбросить фильтр', sort: 'Сортировать', download: 'Скачать', file_download: 'Скачать', upload: 'Загрузить', file_upload: 'Загрузить', attach_file: 'Прикрепить файл',
  visibility: 'Показать', visibility_off: 'Скрыть', settings: 'Настройки', tune: 'Настройки', info: 'Информация', help: 'Справка', help_outline: 'Справка', print: 'Печать', open_in_new: 'Открыть в новой вкладке',
  link: 'Ссылка', history: 'История', send: 'Отправить', create_new_folder: 'Создать папку', undo: 'Отменить', redo: 'Повторить', logout: 'Выйти', login: 'Войти', person: 'Профиль', home: 'Главная',
  star: 'Избранное', star_border: 'Избранное', lock: 'Заблокировать', lock_open: 'Разблокировать', fullscreen: 'Во весь экран', fullscreen_exit: 'Выйти из полноэкранного', list: 'Список', view_list: 'Список',
  calendar_today: 'Календарь', event: 'Календарь', schedule: 'Время', publish: 'Опубликовать', archive: 'В архив', unarchive: 'Из архива', restore: 'Восстановить', swap_horiz: 'Поменять местами', drag_indicator: 'Перетащить',
}
export const ICON_SEL = 'i.q-icon, .material-icons, .material-icons-outlined, .material-symbols-outlined, .v-icon'
/** A button's icon: its name and that in words (an unknown icon — its name only). */
export function iconOf(el: Element): { name: string; word?: string } | undefined {
  const i = el.matches(ICON_SEL) ? el : el.querySelector(ICON_SEL)
  const name = (i?.textContent ?? '').trim() || [...(i?.classList ?? [])].find((c) => /^mdi-/.test(c))?.slice(4) || ''
  if (!name || !/^[a-z0-9_-]+$/.test(name)) return undefined
  return { name, word: ICON_WORDS[name.replace(/-/g, '_')] }
}
/** A Quasar field's label (its own words — a badge after it is not the label). */
export function qLabel(el: Element): string {
  const l = el.closest('.q-field')?.querySelector('.q-field__label')
  const own = l ? ownText(l) || textOf(l, 60) : ''
  return own || rowLabelOf(el)?.text || ''
}
/** The header of a cell's column. */
export function columnOf(cell: Element): string {
  const tr = cell.closest('tr')
  const table = cell.closest('table')
  if (!tr || !table) return ''
  const idx = [...tr.children].indexOf(cell)
  const head = table.querySelector('thead tr:last-child') ?? table.querySelector('tr')
  const th = head && head !== tr ? head.children[idx] : undefined
  return th ? textOf(th, 50) : ''
}
/** A row by its most telling value (the first cell with words in it). */
export function rowName(tr: Element): string {
  for (const c of tr.children) {
    const t = textOf(c, 60)
    if (t && t.length >= 2 && !/^\d{1,3}$/.test(t)) return t
  }
  return ''
}
/** Where an element is: a table's row and column, a dialog. */
export function placeOf(el: Element, column = true): string {
  const parts: string[] = []
  const cell = el.closest('td, [role="cell"], [role="gridcell"]')
  const tr = el.closest('tr, [role="row"]')
  if (tr) {
    const r = rowName(tr)
    if (r) parts.push(`в строке «${r}»`)
    const col = cell && column ? columnOf(cell) : ''
    if (col) parts.push(`колонка «${col}»`)
  }
  const dlg = el.closest('.q-dialog, [role="dialog"], dialog')
  if (dlg) {
    const t = dlg.querySelector('.q-card__section .text-h6, .v-card-title, [class*="title"], h1, h2, h3')
    const tt = t ? textOf(t, 60) : ''
    if (tt) parts.push(`в окне «${tt}»`)
  }
  return parts.length ? ` ${parts.join(', ')}` : ''
}
/**
 * A file field, found as what it is — not by the words near it (an uploader's header shows the file's size and
 * progress: «0.0B / 0.00%» changes): the page's only file input; else the one of its dialog (by the dialog's
 * title); else by its number among the page's file inputs. Playwright sets files into a hidden input as well.
 */
export function fileInputLocator(el: HTMLInputElement): string {
  const all = [...document.querySelectorAll('input[type="file"]')]
  if (all.length <= 1) return `page.locator('input[type="file"]')`
  const d = dialogScope(el)
  if (d) {
    const mine = [...d.root.querySelectorAll('input[type="file"]')]
    const scoped = `${d.code}.locator('input[type="file"]')`
    return mine.length > 1 ? `${scoped}.nth(${mine.indexOf(el)})` : scoped
  }
  return `page.locator('input[type="file"]').nth(${all.indexOf(el)})`
}
/** The last cell / field clicked — an input without a label of its own that opens after it (an editing popup) is that one. */
export let lastPlace: { what: string; at: number } | undefined
/** The list being picked from (its field's name). */
export let lastList: string | undefined
/** What an element is, in words: «кнопку «Изменить»», «поле «Название»», «ячейку «Наименование»». */
export function whatOf(el: Element): { kind: 'button' | 'field' | 'list' | 'item' | 'check' | 'tab' | 'link' | 'cell' | 'other'; text: string } {
  const aria = (el.getAttribute('aria-label') ?? '').trim()
  const title = (el.getAttribute('title') ?? '').trim()
  if (el.closest('.q-menu, [role="menu"], [role="listbox"]') && (el.matches('.q-item, [role="option"], [role="menuitem"]') || el.closest('.q-item, [role="option"], [role="menuitem"]'))) {
    const item = el.closest('.q-item, [role="option"], [role="menuitem"]') ?? el
    return { kind: 'item', text: textOf(item, 60) || aria || title }
  }
  if (el.matches('[role="tab"], .q-tab')) return { kind: 'tab', text: textOf(el, 60) || aria || title }
  if (el.matches('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"], .q-checkbox, .q-radio, .q-toggle')) {
    const host = el.closest('.q-checkbox, .q-radio, .q-toggle, label') ?? el
    return { kind: 'check', text: aria || labelOf(el) || textOf(host, 60) || title }
  }
  if (el.closest('.q-select, [role="combobox"]') || el instanceof HTMLSelectElement) return { kind: 'list', text: qLabel(el) || labelOf(el) || aria || title || (el as HTMLInputElement).placeholder || '' }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.closest('.q-field')) {
    const own = qLabel(el) || labelOf(el) || aria || (el as HTMLInputElement).placeholder?.trim() || title
    return { kind: 'field', text: own }
  }
  if (el.matches('a[href], [role="link"]')) return { kind: 'link', text: textOf(el, 60) || aria || title }
  if (el.matches('button, [role="button"], .q-btn, input[type="button"], input[type="submit"]')) {
    const t = aria || textOf(el, 60) || title
    if (t) return { kind: 'button', text: t }
    const ic = iconOf(el)
    return { kind: 'button', text: ic ? (ic.word ?? `иконка «${ic.name}»`) : '' }
  }
  const cell = el.closest('td, [role="cell"], [role="gridcell"]')
  if (cell) return { kind: 'cell', text: columnOf(cell) }
  return { kind: 'other', text: aria || textOf(el, 60) || title }
}
export const qt = (t: string) => `«${t}»`
/** A click in words. */
export function sayClick(el: Element, dbl = false): string {
  const w = whatOf(el)
  const w0 = whatOf(el)
  const place = placeOf(el, !(w0.kind === 'button' || w0.kind === 'link' || w0.kind === 'check'))
  const v = dbl ? 'Дважды щёлкнуть' : 'Нажать'
  let out: string
  if (w.kind === 'item') out = `Выбрать ${qt(w.text)}${lastList ? ` в списке ${qt(lastList)}` : ''}`
  else if (w.kind === 'list') out = `Открыть список ${w.text ? qt(w.text) : 'без подписи'}${place}`
  else if (w.kind === 'tab') out = `Открыть вкладку ${qt(w.text)}`
  else if (w.kind === 'link') out = `Перейти по ссылке ${qt(w.text)}${place}`
  else if (w.kind === 'check') out = `${(el as HTMLInputElement).checked === false ? 'Снять отметку' : 'Отметить'} ${w.text ? qt(w.text) : 'флажок'}${place}`
  else if (w.kind === 'field') out = `Щёлкнуть поле ${w.text ? qt(w.text) : 'без подписи'}${place}`
  else if (w.kind === 'cell') out = `${dbl ? 'Дважды щёлкнуть' : 'Щёлкнуть'} ячейку${w.text ? ` ${qt(w.text)}` : ''}${placeOf(el).replace(/, колонка «[^»]*»/, '')}`
  else if (w.kind === 'button') out = `${v} ${w.text ? qt(w.text) : 'кнопку без подписи'}${place}`
  else out = `${dbl ? 'Дважды щёлкнуть' : 'Щёлкнуть'} ${w.text ? qt(w.text) : 'по элементу'}${place}`
  // what was clicked is where an input without a label of its own will be
  if (w.kind === 'list') lastList = w.text || undefined
  else if (w.kind !== 'item') lastList = undefined
  // an input without a label right after: the cell clicked — or the editing a button in a row opened
  if (w.kind === 'cell') lastPlace = { what: `ячейку${w.text ? ` ${qt(w.text)}` : ''}${placeOf(el, false)}`, at: Date.now() }
  else if (w.kind === 'button' || w.kind === 'field') lastPlace = { what: `поле редактирования${placeOf(el, false)}`, at: Date.now() }
  return out
}
/** The field typed into, in words. */
export function fieldWords(el: Element): string {
  const w = whatOf(el)
  if (w.text) return `поле ${qt(w.text)}${placeOf(el)}`
  // no label: the name its test id gives it («uom-2» — «uom»)
  const tid = testIdHolder(el)
  if (tid) return `поле ${qt(testIdOf(tid.value).stem)}${placeOf(el)}`
  // no label: the cell / place clicked just before (an editing popup over a table's cell)
  if (lastPlace && Date.now() - lastPlace.at < 60000) return lastPlace.what
  return `поле без подписи${placeOf(el)}`
}
export const say = (code: string, words: string) => `${code} // шаг: ${words.replace(/\s+/g, ' ').trim()}`

export const CLICKABLE = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], .q-item, .q-btn, .q-chip, .q-tab, .q-checkbox, .q-radio, .q-toggle, [onclick], [tabindex]'
export const targetOf = (e: Event) => ((e.target as Element)?.closest?.(CLICKABLE) ?? (e.target as Element)) as Element
