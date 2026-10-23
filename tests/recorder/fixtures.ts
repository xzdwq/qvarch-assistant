/**
 * Pages the recorder meets (their structure as Quasar apps build it, neutral words): each with the element a person
 * acts on (data-target) and, where it matters, how the page grows before a replay (more records, a dialog on top) —
 * a locator recorded on the first must still find that very element on the second.
 */
export interface Fixture {
  name: string
  html: string
  /** What the recorder makes the locator with: a typing's, a list field's, a file field's. */
  kind: 'typing' | 'list' | 'file' | 'click'
  /** The page changed before the replay (run in the page). */
  grow?: string
  /** What the locator must be made by (the app's own test ids — before anything else). */
  by?: RegExp
}

/** A Quasar field (its native input inside its control), read-only or not, with no label. */
const field = (value: string, readonly: boolean, target = false) =>
  `<label class="q-field row"><div class="q-field__inner relative-position"><div class="q-field__control relative-position"><div class="q-field__control-container col"><input class="q-field__native q-placeholder" type="text" ${readonly ? 'readonly' : ''} value="${value}" ${target ? 'data-target="1"' : ''}></div></div></div></label>`
const savedRecord = (n: number) => `<form class="q-form"><div class="item-grid">${field(`Запись ${n}`, true)}${field(`КОД-${n}`, true)}${field('', true)}</div><button class="q-btn"><i class="q-icon">edit</i></button></form>`

/** A field that opens a list (its control clicked), read-only like a select's, with no label. */
const listField = (value: string, target = false) =>
  `<label class="q-field row"><div class="q-field__inner relative-position"><div class="q-field__control relative-position" ${target ? 'data-target="1"' : ''}><div class="q-field__control-container col"><input class="q-field__native q-placeholder" type="text" readonly value="${value}"></div></div></div></label>`
/** A record of a list of records, each its own form inside the page's form (a Vue app nests them; HTML can't): saved ones read-only. */
const record = (n: number, saved: boolean, target?: 'typing' | 'list') =>
  `<div class="record-grid !p-0">${field(saved ? `Запись ${n}` : '', saved, target === 'typing')}${saved ? listField('шт') : listField('', target === 'list')}${field(saved ? `КОД-${n}` : '', saved)}</div>`
/** The page: a form with its filters, the records' forms inside it (made by a script: the parser drops a nested form). */
const recordsPage = (records: string[]) => `<form class="q-form"><div class="filters row">${field('', false)}${field('', false)}</div><div id="list"></div></form>
<script>window.addRec = (h, beforeNew) => { const f = document.createElement('form'); f.className = 'q-form'; f.innerHTML = h; const l = document.getElementById('list'); l.insertBefore(f, beforeNew ? l.querySelector('[data-target]').closest('form') : null) }
${records.map((h) => `addRec(${JSON.stringify(h)})`).join('\n')}</script>`
/** More saved records (before the new one, or after all). */
const growSaved = (before: boolean) => `[7, 8, 9].forEach((n) => addRec(${JSON.stringify(record(0, true))}.replace(/ 0"/g, ' ' + n + '"').replace(/-0"/g, '-' + n + '"'), ${before}))`

/** A Quasar field with its test id on its root (as Quasar puts a component's attributes), no label. */
const tidField = (tid: string, value: string, readonly: boolean, target?: 'input' | 'control') =>
  `<label class="q-field row" data-testid="${tid}"><div class="q-field__inner"><div class="q-field__control" ${target === 'control' ? 'data-target="1"' : ''}><div class="q-field__control-container col"><input class="q-field__native" type="text" ${readonly ? 'readonly' : ''} value="${value}" ${target === 'input' ? 'data-target="1"' : ''}></div></div></div></label>`
/** Records of a v-for, each field's test id numbered by its index; the new one last; `target` — in the new one. */
const tidRecords = (saved: number, target: 'input' | 'control') =>
  [...Array(saved).keys()].map((i) => `<div class="rec">${tidField(`item-name-${i}`, `Запись ${i}`, true)}${tidField(`item-uom-${i}`, 'шт', true)}</div>`).join('') +
  `<div class="rec">${tidField(`item-name-${saved}`, '', false, target === 'input' ? 'input' : undefined)}${tidField(`item-uom-${saved}`, '', true, target === 'control' ? 'control' : undefined)}</div>`
/** More saved records before the new one, every index renumbered (as a v-for draws it again). */
const tidGrow = `(() => { const l = document.getElementById('recs'); for (let i = 0; i < 3; i++) l.insertAdjacentHTML('afterbegin', l.querySelector('.rec').outerHTML.replace(/data-target="1"/g, '')); [...l.querySelectorAll('.rec')].forEach((r, i) => r.querySelectorAll('[data-testid]').forEach((e) => e.setAttribute('data-testid', e.getAttribute('data-testid').replace(/\\d+$/, String(i))))) })()`

export const FIXTURES: Fixture[] = [
  {
    name: 'a new record\'s field among saved ones (read-only, more of them later)',
    kind: 'typing',
    html: `<div class="filters"><input class="q-field__native" type="text" placeholder="Поиск"></div>
<div id="list">${savedRecord(1)}${savedRecord(2)}</div>
<form class="q-form" id="new"><div class="item-grid">${field('', false, true)}${field('', false)}${field('', false)}</div></form>`,
    grow: `document.getElementById('list').insertAdjacentHTML('beforeend', ${JSON.stringify(savedRecord(3) + savedRecord(4))})`,
  },
  {
    name: 'a field in a dialog over a table whose header has the same words',
    kind: 'list',
    html: `<div class="q-dialog" role="dialog"><div class="q-card__section"><div class="text-h6">Массовое создание</div></div>
<div class="q-card__section q-card__section--vert scroll"><table><tr><th>Наименование</th><th>Группа</th></tr>
<tr><td>Болт</td><td><label class="q-field q-select"><input role="combobox"></label></td></tr></table></div></div>
<div class="q-dialog" role="dialog"><div class="q-card__section"><div class="text-h6">Распространить значение на всю колонку</div></div>
<div class="q-card__section q-card__section--vert scroll"><div class="row"><div>Группа</div><div><label class="q-field q-select"><input role="combobox" data-target="1"></label></div></div></div></div>`,
    grow: `document.querySelector('table').insertAdjacentHTML('beforeend', '<tr><td>Гайка</td><td><label class="q-field q-select"><input role="combobox"></label></td></tr>')`,
  },
  {
    name: 'a file field of an upload dialog (its header shows the size and progress) with another file field on the page',
    kind: 'file',
    html: `<input type="file" id="avatar">
<div class="q-dialog" role="dialog"><div class="q-card__section"><div class="text-h6">Загрузить файл</div></div>
<div class="q-uploader"><div class="q-uploader__header"><div>Размер файла не более 2 Mb</div><div>0.0B / 0.00%</div></div><input type="file" class="q-uploader__input" data-target="1" style="opacity:0"></div></div>`,
    grow: `document.querySelector('.q-uploader__header').lastElementChild.textContent = '1.2MB / 100.00%'`,
  },
  {
    name: 'a labelled field in a dialog',
    kind: 'typing',
    html: `<div class="q-dialog" role="dialog"><div class="q-card__section"><div class="text-h6">Новая запись</div></div>
<label class="q-field"><div class="q-field__label">Наименование</div><input data-target="1"></label>
<label class="q-field"><div class="q-field__label">Полное наименование</div><input></label></div>`,
  },
  {
    name: 'an icon button in a table row (rows added above it later)',
    kind: 'click',
    html: `<table><tbody id="rows"><tr><td>Болт</td><td><button class="q-btn"><i class="q-icon">edit</i></button></td></tr>
<tr><td>Гайка</td><td><button class="q-btn" data-target="1"><i class="q-icon">edit</i></button></td></tr></tbody></table>`,
    grow: `document.getElementById('rows').insertAdjacentHTML('afterbegin', '<tr><td>Шайба</td><td><button class="q-btn"><i class="q-icon">edit</i></button></td></tr>')`,
  },
  {
    name: "records' forms in the page's form: a new record's list opened (no label), more saved ones put before it",
    kind: 'click',
    html: recordsPage([record(1, true), record(2, true), record(0, false, 'list')]),
    grow: growSaved(true),
  },
  {
    name: "records' forms in the page's form: typing in a new record (no label), more saved ones put before it",
    kind: 'typing',
    html: recordsPage([record(1, true), record(2, true), record(0, false, 'typing')]),
    grow: growSaved(true),
  },
  {
    name: "records' forms in the page's form: a new record on top, more saved ones after it",
    kind: 'click',
    html: recordsPage([record(0, false, 'list'), record(1, true), record(2, true)]),
    grow: growSaved(false),
  },
  {
    name: 'test id numbered by a v-for: typing in the new record, its index shifted by more saved ones',
    kind: 'typing',
    html: `<div id="recs">${tidRecords(2, 'input')}</div>`,
    grow: tidGrow,
    by: /getByTestId\(\/\^item-(name|uom)/,
  },
  {
    name: "test id numbered by a v-for: the new record's list opened (its field's root has the id)",
    kind: 'list',
    html: `<div id="recs">${tidRecords(2, 'control')}</div>`,
    grow: tidGrow,
    by: /getByTestId\(\/\^item-(name|uom)/,
  },
  {
    name: 'test id numbered by a v-for: a list field clicked on its control',
    kind: 'click',
    html: `<div id="recs">${tidRecords(2, 'control')}</div>`,
    grow: tidGrow,
    by: /getByTestId\(\/\^item-(name|uom)/,
  },
  {
    name: 'a plain test id before anything else (the same words elsewhere)',
    kind: 'click',
    html: `<button class="q-btn">Сохранить</button><div class="q-dialog" role="dialog"><button class="q-btn" data-testid="item-save" data-target="1">Сохранить</button></div>`,
    by: /^page\.getByTestId\('item-save'\)$/,
  },
]
