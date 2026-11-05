import { selectorOf, UI, xpathTest } from '../../shared/browser/uiKits'
import { FIELDS, fieldsIn, hasExact, ownText, q, textOf, visible, xq } from './domText'

/** Locators by what a person sees around an element: a field's label, its row's label, a table row, a dialog, a menu. */

/** The dialog an element is in and its title's words (none — ''). */
export function dialogOf(el: Element): { root: Element; title: string } | undefined {
  const root = el.closest(UI.dialog)
  if (!root) return undefined
  const title = root.querySelector(UI.dialogTitle)
  return { root, title: title ? textOf(title, 60) : '' }
}
/** The dialog an element is in, by its title: a locator to look inside it, and its element. */
export function dialogScope(el: Element): { code: string; root: Element } | undefined {
  const d = dialogOf(el)
  return d?.title ? { code: `page.locator(${q(selectorOf(d.root, 'dialog'))}).filter({ hasText: ${q(d.title)} })`, root: d.root } : undefined
}
/** What a scope around the element could be (a dialog, a menu), as a locator and its root. */
export function scopeOf(el: Element): { code: string; root: Element } | undefined {
  const menu = el.closest(UI.menu)
  if (menu) return { code: `page.locator(${q(selectorOf(menu, 'menu'))})`, root: menu }
  return dialogScope(el)
}
/** A kit's field (an input, a select in its wrapper): by its label — its value changes, its label does not. */
export function fieldLocator(el: Element): string | undefined {
  const fld = el.closest(UI.field)
  const lab = fld?.querySelector(UI.fieldLabel)
  // the label's own words (a badge in it — «Изменено», a star — is not the label)
  const t = lab ? ownText(lab) || textOf(lab, 60) : ''
  if (!fld || !t) return undefined
  const esc = t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  // (the field's dialog its scope — the fields of the page under it are not counted)
  const d = dialogScope(el)
  const at = d?.code ?? 'page'
  const labels = [...(d?.root ?? document).querySelectorAll(UI.field)].filter(visible).map((x) => {
    const l = x.querySelector(UI.fieldLabel)
    return { x, t: l ? textOf(l, 80) : '' }
  })
  // «Статус …» — the label starting with it (a badge after it later changes nothing), unless another field's starts so too
  const starts = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `))
  const re = starts.length <= 1 ? `/^\\s*${esc}(\\s|$)/` : `/^\\s*${esc}\\s*$/`
  if (starts.length <= 1) return `${at}.locator(${q(UI.field)}, { has: page.locator(${q(UI.fieldLabel)}, { hasText: ${re} }) })`
  // another label starts so too («Статус оплаты»): the label's own first words exactly (a badge after them is no matter)
  const xp = `${d ? './/' : '//'}*[${xpathTest(UI.field)}][.//*[${xpathTest(UI.fieldLabel)}][normalize-space(text()[1])=${xq(t)}]]`
  const same = labels.filter((l) => l.t === t || l.t.startsWith(`${t} `)).map((l) => l.x).filter((x) => ownText(x.querySelector(UI.fieldLabel)!) === t)
  const base = `${at}.locator(${q(`xpath=${xp}`)})`
  return same.length > 1 ? `${base}.nth(${Math.max(0, same.indexOf(fld))})` : base
}
/**
 * A field's label beside it (a form row «Категория [ поле ]» — the label outside the field): the nearest
 * text before the field within its row, a few levels up; a row holding another field is not its row.
 */
export function rowLabelOf(el: Element): { text: string; raw: string; row: Element } | undefined {
  let branch: Element = el.closest(UI.field) ?? el
  for (let up = 0; up < 4 && branch.parentElement && branch.parentElement !== document.body; up++) {
    const row = branch.parentElement
    if (row.matches(`form, table, tbody, thead, ${UI.dialog}`)) return undefined
    for (let p = branch.previousElementSibling; p; p = p.previousElementSibling) {
      if (p.matches(FIELDS) || p.querySelector(FIELDS)) return undefined
      const t = textOf(p, 60)
      if (t && t.length >= 2) return { text: t.replace(/[:*]\s*$/, '').trim(), raw: t, row }
    }
    if (fieldsIn(row) > 1) return undefined
    branch = row
  }
  return undefined
}
/**
 * A field by its row's label, exactly («Наименование» is not «Полное наименование»): the rows (by their classes)
 * holding that very text → the one of ours (its number when several) → its field (its number in the row).
 */
export function rowFieldLocator(el: Element): string | undefined {
  const r = rowLabelOf(el)
  if (!r) return undefined
  const cls = [...r.row.classList].filter((c) => /^[a-z][\w-]*$/i.test(c) && !/\d{2,}|active|focus|hover/.test(c)).slice(0, 3)
  const sel = r.row.tagName.toLowerCase() + cls.map((c) => `.${c}`).join('')
  // looked for where the field is: its dialog (by the dialog's title) — not over the whole page, where a table under
  // the dialog may have the same words in its header and a number counted at recording means nothing at a replay
  const d = dialogScope(el)
  const rows = [...(d?.root ?? document).querySelectorAll(sel)].filter((x) => visible(x) && hasExact(x, r.raw) && x.querySelector(FIELDS))
  const k = rows.indexOf(r.row)
  if (k < 0) return undefined
  const wrap = el.closest(UI.field)
  const inner = wrap ? UI.field : 'input, textarea, select'
  const fields = [...r.row.querySelectorAll(inner)]
  const i = Math.max(0, fields.indexOf(wrap ?? el))
  return `${d?.code ?? 'page'}.locator(${q(sel)}).filter({ has: page.getByText(${q(r.raw)}, { exact: true }) })${rows.length > 1 ? `.nth(${k})` : ''}.locator(${q(inner)})${fields.length > 1 ? `.nth(${i})` : ''}`
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
