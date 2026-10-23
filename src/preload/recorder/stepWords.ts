import { labelOf, ownText, textOf } from './domText'
import { rowLabelOf } from './fieldLocators'
import { testIdHolder, testIdOf } from './testIdLocators'

/** A step in words (written at once, while the page is there: the element's kind, name, place). */

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
/** The last cell / field clicked — an input without a label of its own that opens after it (an editing popup) is that one. */
export let lastPlace: { what: string; at: number } | undefined
/** The list being picked from (its field's name). */
export let lastList: string | undefined
/** What an element clicked is (its kind decides the step's words). */
export const ELEMENT_KINDS = ['button', 'field', 'list', 'item', 'check', 'tab', 'link', 'cell', 'other'] as const
export type ElementKind = (typeof ELEMENT_KINDS)[number]
/** Kinds whose place in a table is its row only (a button / a link / a flag in a column is not the column's value). */
const ROW_ONLY_KINDS: ReadonlySet<ElementKind> = new Set(['button', 'link', 'check'])
/** Kinds whose click may open an input without a label of its own (a row's edit button, a field's popup). */
const EDIT_OPENER_KINDS: ReadonlySet<ElementKind> = new Set(['button', 'field'])
/** What an element is, in words: «кнопку «Изменить»», «поле «Название»», «ячейку «Наименование»». */
export function whatOf(el: Element): { kind: ElementKind; text: string } {
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
/** A click in words, by the element's kind (`place` — where it is; `verb` — «Нажать» / «Дважды щёлкнуть»). */
const CLICK_WORDS: Record<ElementKind, (w: { text: string }, el: Element, place: string, dbl: boolean, verb: string) => string> = {
  item: (w) => `Выбрать ${qt(w.text)}${lastList ? ` в списке ${qt(lastList)}` : ''}`,
  list: (w, _el, place) => `Открыть список ${w.text ? qt(w.text) : 'без подписи'}${place}`,
  tab: (w) => `Открыть вкладку ${qt(w.text)}`,
  link: (w, _el, place) => `Перейти по ссылке ${qt(w.text)}${place}`,
  check: (w, el, place) => `${(el as HTMLInputElement).checked === false ? 'Снять отметку' : 'Отметить'} ${w.text ? qt(w.text) : 'флажок'}${place}`,
  field: (w, _el, place) => `Щёлкнуть поле ${w.text ? qt(w.text) : 'без подписи'}${place}`,
  cell: (w, el, _place, dbl) => `${dbl ? 'Дважды щёлкнуть' : 'Щёлкнуть'} ячейку${w.text ? ` ${qt(w.text)}` : ''}${placeOf(el).replace(/, колонка «[^»]*»/, '')}`,
  button: (w, _el, place, _dbl, verb) => `${verb} ${w.text ? qt(w.text) : 'кнопку без подписи'}${place}`,
  other: (w, _el, place, dbl) => `${dbl ? 'Дважды щёлкнуть' : 'Щёлкнуть'} ${w.text ? qt(w.text) : 'по элементу'}${place}`,
}
/** A click in words. */
export function sayClick(el: Element, dbl = false): string {
  const w = whatOf(el)
  const place = placeOf(el, !ROW_ONLY_KINDS.has(w.kind))
  const out = CLICK_WORDS[w.kind](w, el, place, dbl, dbl ? 'Дважды щёлкнуть' : 'Нажать')
  // the list being picked from: a list opened sets it, its item keeps it, anything else ends it
  if (w.kind !== 'item') lastList = w.kind === 'list' ? w.text || undefined : undefined
  // an input without a label right after: the cell clicked — or the editing a button in a row opened
  if (w.kind === 'cell') lastPlace = { what: `ячейку${w.text ? ` ${qt(w.text)}` : ''}${placeOf(el, false)}`, at: Date.now() }
  else if (EDIT_OPENER_KINDS.has(w.kind)) lastPlace = { what: `поле редактирования${placeOf(el, false)}`, at: Date.now() }
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
