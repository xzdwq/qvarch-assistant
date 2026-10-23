/// <reference lib="dom" />
import { ipcRenderer, webUtils } from 'electron'
import { PAGE_MARK } from '../shared/browser/pageMarks'
import { CHECKABLE_INPUT_TYPES, TEXT_INPUT_TYPES, q, textOf, fieldLocator, rowFieldLocator, listFieldLocator, locatorFor, placeOf, fileInputLocator, whatOf, qt, sayClick, fieldWords, say, targetOf } from './recorderDom'

/**
 * Recording a Playwright scenario in the app's browser: clicks, typing, Enter / Escape, choices in lists — each
 * as a line of Playwright code with a locator a person would write (test id → role and name → placeholder /
 * label → text, narrowed to a menu / a dialog when not unique → CSS). Quasar's icon ligatures (aria-hidden) are
 * not names. Passwords are never written down. The lines go to the app; it puts them into the note's block.
 */
/** A line; `replace` — the same click just written (twice: a double click) goes, this one stands for it. */
type Act = {
  code: string
  note?: string
  replace?: string
  /** Files picked into a file field / dropped onto an element: kept with the notebook, the line made from them there. */
  files?: { how: 'input' | 'drop'; loc: string; paths: string[]; where: string; opener?: boolean }
}
let on = false

// typing: one fill() per field, written when the next thing happens
let typing: { el: HTMLInputElement | HTMLTextAreaElement; loc: string } | undefined
function flush(): void {
  const t = typing
  typing = undefined
  if (!t) return
  const where = fieldWords(t.el)
  const into = `в ${where}`
  if (t.el instanceof HTMLInputElement && t.el.type === 'password') send({ code: say(`await ${t.loc}.fill('')`, `Ввести пароль ${into} (пароль не записывается — подставьте сами)`), note: 'пароль' })
  else send({ code: say(`await ${t.loc}.fill(${q(t.el.value)})`, t.el.value ? `Ввести ${qt(t.el.value.length > 80 ? `${t.el.value.slice(0, 80)}…` : t.el.value)} ${into}` : `Очистить ${where}`) })
}
function send(a: Act): void {
  ipcRenderer.send('qa:pwrec-act', a)
  flashBadge()
}

let lastField: string | undefined
/** A field that opens a list of options when clicked (a select, a combobox — Quasar's q-select with its search box). */
const opensList = (el: Element) => el.getAttribute('role') === 'combobox' || /^(listbox|true|menu)$/.test(el.getAttribute('aria-haspopup') ?? '') || !!el.closest('.q-select, [role="combobox"]')
function onClick(e: MouseEvent): void {
  if (!on || !e.isTrusted || (e.target as Element)?.closest?.('#qa-pwrec')) return
  const el = targetOf(e)
  // the page itself (an empty spot): nothing to repeat
  if (el === document.documentElement || el === document.body) return
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) {
    // a typing field: its click is nothing to repeat (the typing is) — unless it opens a list (a select with a search
    // box): without that click a replay finds the list shut and its option nowhere
    if (!opensList(el)) return
    if (typing && typing.el !== el) flush()
    // the field by its label (its .q-field), else the input itself — the check of the pick follows what this points at
    const { loc: fld, onField } = listFieldLocator(el)
    send({ code: say(`await ${fld}.click()`, `Открыть список ${fieldWords(el).replace(/^поле /, "")}`) })
    lastField = fld
    lastFieldEl = onField ? (el.closest('.q-field') ?? el) : el
    return
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
  if (typing && typing.el !== el) flush()
  const loc = locatorFor(el)
  const words = sayClick(el)
  if (el instanceof HTMLInputElement && CHECKABLE_INPUT_TYPES.has(el.type)) send({ code: say(`await ${loc}.${el.checked ? 'check' : 'uncheck'}()`, words) })
  else send({ code: say(`await ${loc}.click()`, words) })
  // a field opened: remembered; one of its options picked — the field must show it before the next step
  if (el.closest('.q-field')) ((lastField = fieldLocator(el) ?? rowFieldLocator(el)), (lastFieldEl = el.closest('.q-field') ?? undefined))
  else if (lastField && el.closest('.q-menu, [role="listbox"]') && (el.getAttribute('role') === 'option' || el.matches('.q-item'))) expectPicked(lastField, lastFieldEl, textOf(el, 60))
}
let lastFieldEl: Element | undefined
/**
 * An option picked: the field must show it before the next step — checked the way the field shows it, looked at a
 * moment after the pick: its text (a select's chip, its shown value) or its input's value (a select with a search box
 * filled by the pick). Shown neither way — no check (a wrong one would fail a right replay).
 */
function expectPicked(loc: string, fieldEl: Element | undefined, opt: string): void {
  lastField = undefined
  lastFieldEl = undefined
  if (!opt || !fieldEl) return
  setTimeout(() => {
    const input = (fieldEl.matches('input') ? fieldEl : fieldEl.querySelector('input')) as HTMLInputElement | null
    const shown = (fieldEl as HTMLElement).innerText ?? ''
    if (shown.includes(opt)) send({ code: say(`await expect(${loc}).toContainText(${q(opt)})`, '-') })
    // (the value in the field's input: the input itself checked — the field's locator may already be the input)
    else if (input && input.value.trim() === opt) send({ code: say(`await expect(${input === fieldEl ? loc : `${loc}.locator('input').first()`}).toHaveValue(${q(opt)})`, '-') })
  }, 250)
}
function onDbl(e: MouseEvent): void {
  if (!on || !e.isTrusted || (e.target as Element)?.closest?.('#qa-pwrec')) return
  const el = targetOf(e)
  if (el === document.documentElement || el === document.body) return
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
  const loc = locatorFor(el)
  send({ code: say(`await ${loc}.dblclick()`, sayClick(el, true)), replace: `await ${loc}.click()` })
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
/**
 * A file field opened (a click on it — the person's, or the page's own input.click() from its «Загрузить» button):
 * the files chosen next replace the click that opened the system's window (a replay never shows that window).
 */
let fileOpenAt = 0
document.addEventListener('click', (e) => (e.target as Element)?.matches?.('input[type="file"]') && (fileOpenAt = Date.now()), true)
const pathsOf = (list: FileList | null | undefined) => [...(list ?? [])].map((f) => webUtils.getPathForFile(f)).filter(Boolean)
function onDrop(e: DragEvent): void {
  if (!on || !e.isTrusted || !e.dataTransfer?.files.length) return
  const paths = pathsOf(e.dataTransfer.files)
  const el = targetOf(e)
  if (!paths.length || !el || el === document.documentElement) return
  flush()
  send({ code: '', files: { how: 'drop', loc: locatorFor(el), paths, where: whatOf(el).text || 'область загрузки' } })
}
function onChange(e: Event): void {
  if (!on || !e.isTrusted) return
  const el = e.target as Element
  if (el instanceof HTMLInputElement && el.type === 'file') {
    const paths = pathsOf(el.files)
    if (!paths.length) return
    flush()
    send({ code: '', files: { how: 'input', loc: fileInputLocator(el), paths, where: placeOf(el).trim().replace(/^в /, ''), opener: Date.now() - fileOpenAt < 300_000 } })
    fileOpenAt = 0
    return
  }
  if (el instanceof HTMLSelectElement) {
    flush()
    const opt = el.selectedOptions[0]?.textContent?.trim() || el.value
    send({ code: say(`await ${locatorFor(el)}.selectOption(${q(el.value)})`, `Выбрать ${qt(opt)} в списке ${qt(whatOf(el).text || 'без подписи')}`) })
  } else if (typing?.el === el) flush()
}
function onKey(e: KeyboardEvent): void {
  if (!on || !e.isTrusted || !['Enter', 'Escape', 'Tab'].includes(e.key)) return
  const el = e.target as Element
  const loc = typing?.el === el ? typing.loc : el && el !== document.body ? locatorFor(el) : undefined
  flush()
  if (e.key === 'Tab') return
  const key = e.key === 'Escape' ? 'Esc' : e.key
  send({ code: say(loc ? `await ${loc}.press(${q(e.key)})` : `await page.keyboard.press(${q(e.key)})`, el && el !== document.body && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? `Нажать ${key} в ${fieldWords(el)}` : `Нажать ${key}`) })
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
  box.style.cssText = `position:fixed;z-index:2147483646;pointer-events:none;border:2px solid ${PAGE_MARK.line};border-radius:3px;background:${PAGE_MARK.faintFill};display:none`
  badge = document.createElement('div')
  badge.id = 'qa-pwrec'
  badge.style.cssText = `position:fixed;z-index:2147483647;right:10px;bottom:10px;padding:5px 10px;border-radius:14px;background:${PAGE_MARK.line};color:${PAGE_MARK.onLine};font:600 12px system-ui,sans-serif;box-shadow:0 2px 8px ${PAGE_MARK.shadow};pointer-events:none`
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
document.addEventListener('drop', onDrop, true)
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
