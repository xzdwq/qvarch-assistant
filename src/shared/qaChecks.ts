import { emptyFuzz, fuzzLines } from './fuzz'
/**
 * «Проверить ▾» of a Playwright block: the recorded actions wrapped into a ready check (the `qa` object of the
 * runner does it). The result of each check — passed / failed / a warning, a sentence, a table «до / после»,
 * pictures (the layout's sizes).
 */
export type QaCheckKind = 'leave' | 'reload' | 'double' | 'repeat' | 'layout' | 'load' | 'context' | 'compare' | 'matrix' | 'files' | 'fuzz'
export interface QaCheck {
  kind: QaCheckKind
  name: string
  state: 'ok' | 'fail' | 'warn'
  /** One sentence: what was done, what came. */
  summary: string
  /** A table: its head and rows (what / before / after…). */
  head?: string[]
  rows?: string[][]
  /** Each row's own verdict (a row to look at is marked). */
  marks?: Array<'ok' | 'warn' | 'fail'>
  /** The rows go in groups by their first cell (shown once per group). */
  group?: boolean
  /** Pictures the check left in the run's folder (layout-<w>x<h>-<zoom>.png), with what each is. */
  shots?: Array<{ file: string; label: string; bad: number }>
}

/** The snapshot's name the context check remembers. */
export const BEFORE_SWITCH = 'до смены'

export const QA_CHECKS: Array<{ id: QaCheckKind; label: string; hint: string }> = [
  { id: 'leave', label: 'Сохранить и уйти', hint: 'Последнее действие — сохранение. После ответа сервера страница уходит назад: окна «несохранённые изменения» быть не должно' },
  { id: 'reload', label: 'Сравнить с перезагрузкой', hint: 'После действий запоминаются поля формы и строки таблиц, страница перезагружается — всё должно остаться как было' },
  { id: 'double', label: 'Двойной клик по сохранению', hint: 'Последний клик делается дважды подряд: на сервер не должны уйти два одинаковых запроса (дубли)' },
  { id: 'repeat', label: 'Повторить действия дважды', hint: 'Действия после открытия страницы выполняются два раза подряд: видно, что отправлялось и как менялось число строк' },
  { id: 'layout', label: 'Вёрстка на разных экранах', hint: 'Страница в конце сценария на ширинах 375 / 768 / 1280 / 1920 и масштабах 80 / 100 / 125 %: прокрутка вбок, вылезающий и обрезанный текст, перекрытия, элементы за краем — со снимками' },
  { id: 'load', label: 'Нагрузка: повторить до 300 раз', hint: 'Последнее действие (например «Добавить строку») повторяется до 300 раз: строки в DOM, узлы, задержка ввода, долгие задачи — нужен ли виртуальный скролл' },
  { id: 'files', label: 'Прогнать с разными файлами', hint: 'Сценарий с загрузкой файла — по разу на каждый файл набора из «Тестовых файлов» (набор того файла, что выбран при записи). Видно: принят файл или отклонён, что ответил сервер и сказала страница, совпало ли с ожиданием файла' },
  { id: 'matrix', label: 'Матрица значений полей', hint: 'Каждое заполняемое в сценарии поле по очереди: пусто, пробелы, слишком длинное, неверные число / дата / e-mail… — остальные как записаны. Видно: сохранилось ли, что сказали форма и сервер, что ушло в запросе. Принятые варианты меняют данные на сервере — в конце записанные значения возвращаются. Значения можно составить самому («Значения матрицы»)' },
  { id: 'fuzz', label: 'Перебор параметров запроса', hint: 'Запрос, который отправил сценарий (поиск, фильтр, выгрузка), отправляется ещё раз с перебором выбранных параметров: массивы из 0 / 1 / 20 / 21 / 100 элементов, пусто, null, длинные строки, числа… Видно: статус, время, сколько найдено; где ломается («с 21 элемента») и где больше значений дали меньше найденных. Вход — как у сценария' },
  { id: 'context', label: 'Сменить контекст: запомнить «до смены»', hint: 'Контекст — то, от чего зависит форма: выбранная компания, раздел, категория, проект, язык, вкладка. Шаг 1: запоминаются все поля сейчас. Шаг 2: «Записать» — переключите контекст. Шаг 3: «Сравнить с «до смены»»' },
  { id: 'compare', label: 'Сравнить с «до смены»', hint: 'Шаг 3: поля после смены контекста сравниваются с запомненными. Значение, которое осталось прежним, показывается — проверьте, должно ли оно было остаться или «протекло» из прошлого контекста' },
]
/** The checks that fit the code now («Сравнить с «до смены»» — when something was remembered). */
export const checksFor = (code: string) => QA_CHECKS.filter((c) => (c.id !== 'compare' || /\bqa\.snapshot\(/.test(code)) && (c.id !== 'files' || /\bqa\.(file|eachFile)\(/.test(code)))

/** The call each check puts into the code. */
const CALL: Record<QaCheckKind, string> = {
  leave: 'saveAndLeave',
  reload: 'sameAfterReload',
  double: 'doubleSubmit',
  repeat: 'repeat',
  layout: 'layout',
  load: 'manyRows',
  context: 'snapshot',
  compare: 'compareWith',
  matrix: 'fieldMatrix',
  files: 'eachFile',
  fuzz: 'fuzz',
}
/** A typed field's line: its indent, its locator, the value as written (with its quotes), its comment. */
const FILL = /^(\s*)await\s+(.+)\.fill\((('|"|`)(?:\\.|(?!\4).)*\4)\)(\s*\/\/.*)?$/
/** The field's name a person reads: the step's words («в поле «…»»), its label / placeholder, else its number. */
function fieldName(locator: string, comment: string, n: number): string {
  const c = /в поле «([^»]+)»/.exec(comment)?.[1]
  if (c) return c
  // a test id's stem: «item-uom» of /^item-uom[-_]\d+$/, or the id as it is
  const tid = /getByTestId\(\/\^(.+?)\[-_\]/.exec(locator)?.[1]?.replace(/\\(.)/g, '$1') ?? /getByTestId\((['"`])(.+?)\1/.exec(locator)?.[2]
  if (tid) return tid
  const l = /getBy(?:Label|Placeholder)\((['"`])(.+?)\1/.exec(locator)?.[2] ?? /getByText\((['"`])(.+?)\1/.exec(locator)?.[2] ?? /hasText:\s*(['"`])(.+?)\1/.exec(locator)?.[2]
  return l ?? `Поле ${n}`
}
const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
/**
 * The matrix: the scenario from its first page line run once per try — each typed field a `v.fN`; the fields
 * (their names, the values recorded, their locators) listed above it.
 */
function matrixWrap(lines: string[]): { code: string } | { error: string } {
  if (lines.some((l) => /\bqa\.eachFile\(/.test(l))) return { error: 'Сценарий уже идёт с каждым файлом набора — матрица с этим не сочетается' }
  if (lines.some((l) => /\bqa\.layoutEach\(/.test(l))) return { error: 'Сценарий уже идёт на каждом экране (вёрстка «весь сценарий») — матрица с этим не сочетается. Переключите вёрстку на «на этой странице»' }
  const start = lines.findIndex((l) => /^\s*await\s+page\./.test(l))
  if (start < 0) return { error: 'В сценарии нет действий — сначала запишите их (кнопка «Записать»)' }
  const fields: string[] = []
  const body = lines.slice(start).map((l) => {
    const m = FILL.exec(l)
    if (!m) return l
    const id = `f${fields.length + 1}`
    fields.push(`  ${id}: { name: ${quote(fieldName(m[2], m[5] ?? '', fields.length + 1))}, value: ${m[3]}, field: () => ${m[2]} },`)
    return `${m[1]}await ${m[2]}.fill(v.${id})${m[5] ?? ''}`
  })
  if (!fields.length) return { error: 'В сценарии нет ввода в поля (строк «Ввести …») — матрице нечего перебирать. Запишите заполнение формы и сохранение' }
  const last = lastAction(lines)
  if (last < 0 || FILL.test(lines[last])) return { error: 'Сценарий кончается вводом — допишите сохранение (запись нажатия «Сохранить»)' }
  const out = [...lines.slice(0, start), 'await qa.fieldMatrix({', ...fields, '}, async (v) => {', ...indent(body), '}) // шаг: Матрица значений полей — каждое поле по очереди']
  return { code: out.join('\n') }
}
// ---------- the matrix's fields as the editor has them (read from the code, written back) ----------
/** A value of one's own: its label, its expression (a literal or gen.…), a value the form should refuse. */
export interface MxCase {
  label: string
  expr: string
  bad: boolean
}
export interface MxField {
  id: string
  name: string
  /** The recorded value as written (with its quotes). */
  value: string
  /** The field's locator (code). */
  field: string
  cases: MxCase[]
}
const LIT = String.raw`('|"|${'`'})(?:\\.|(?!\4).)*\4`
const FIELD_HEAD = new RegExp(String.raw`^\s*(f\d+): \{ name: ('(?:\\.|[^'])*'), value: (${LIT}), field: \(\) => (.*?)(?:, auto: (true|false))?(, cases: \[)?(?: \},)?\s*$`)
const CASE_LINE = /^\s*\{ label: ('(?:\\.|[^'])*'), value: (.*?)(, bad: true)? \},\s*$/
const unq = (s: string) => s.slice(1, -1).replace(/\\(.)/g, '$1')
/** The matrix's lines in the code (its head line, its «}, async (v) => {» line) and its fields. */
export function readMatrix(code: string): { from: number; to: number; fields: MxField[] } | undefined {
  const lines = code.split('\n')
  const from = lines.findIndex((l) => /^\s*await\s+qa\.fieldMatrix\(\{\s*$/.test(l))
  if (from < 0) return undefined
  const to = lines.findIndex((l, i) => i > from && /^\s*\}, async \(v\) => \{\s*$/.test(l))
  if (to < 0) return undefined
  const fields: MxField[] = []
  let cur: MxField | undefined
  for (const l of lines.slice(from + 1, to)) {
    const h = FIELD_HEAD.exec(l)
    if (h) {
      // (a scenario of before may say «auto: …» — no more: the values are one's own only)
      cur = { id: h[1], name: unq(h[2]), value: h[3], field: h[5], cases: [] }
      fields.push(cur)
      if (!h[7]) cur = undefined
      continue
    }
    const c = cur && CASE_LINE.exec(l)
    if (c && cur) cur.cases.push({ label: unq(c[1]), expr: c[2], bad: !!c[3] })
    else if (/^\s*\] \},\s*$/.test(l)) cur = undefined
  }
  return { from, to, fields }
}
/** The fields written back over the matrix's head (their values of their own one a line each). */
export function writeMatrix(code: string, fields: MxField[]): string {
  const at = readMatrix(code)
  if (!at) return code
  const lines = code.split('\n')
  const pad = /^\s*/.exec(lines[at.from])![0]
  const out: string[] = []
  for (const f of fields) {
    const head = `${pad}  ${f.id}: { name: ${quote(f.name)}, value: ${f.value}, field: () => ${f.field}`
    if (!f.cases.length) out.push(`${head} },`)
    else {
      out.push(`${head}, cases: [`)
      for (const c of f.cases) out.push(`${pad}    { label: ${quote(c.label)}, value: ${c.expr || "''"}${c.bad ? ', bad: true' : ''} },`)
      out.push(`${pad}  ] },`)
    }
  }
  return [...lines.slice(0, at.from + 1), ...out, ...lines.slice(at.to)].join('\n')
}

// ---------- the layout's way: on the page at its line / the whole scenario on each screen ----------
export type LayoutMode = 'here' | 'each'
export const layoutModeOf = (code: string): LayoutMode | undefined => (/^\s*await\s+qa\.layoutEach\(/m.test(code) ? 'each' : /^\s*await\s+qa\.layout\(/m.test(code) ? 'here' : undefined)
/**
 * The layout check switched: «here» — a line after the actions (the page where it stands, on every screen); «each» —
 * the actions from the scenario's first page line wrapped, run anew on each screen.
 */
export function setLayoutMode(code: string, mode: LayoutMode): { code: string } | { error: string } {
  if (layoutModeOf(code) === mode) return { code }
  const plain = unwrapCheck(code, 'layout')
  if (mode === 'here') return wrapCheck(plain, 'layout')
  if (/\bqa\.eachFile\(/.test(plain)) return { error: 'Сценарий уже идёт с каждым файлом набора — весь сценарий на каждом экране с этим не сочетается. Оставьте вёрстку «на этой странице»' }
  if (/\bqa\.fieldMatrix\(/.test(plain)) return { error: 'Матрица значений полей уже прогоняет сценарий много раз — весь сценарий на каждом экране с ней не сочетается. Уберите матрицу или оставьте вёрстку «на этой странице»' }
  const lines = plain.replace(/\s+$/, '').split('\n')
  const start = lines.findIndex((l) => /^\s*await\s+page\./.test(l))
  if (start < 0) return { error: 'В сценарии нет действий — сначала запишите их (кнопка «Записать»)' }
  const out = [...lines.slice(0, start), 'await qa.layoutEach({ widths: [375, 768, 1280, 1920], zooms: [100] }, async () => {', ...indent(lines.slice(start)), '}) // шаг: Весь сценарий на каждом экране — вёрстка там, где он кончился']
  return { code: out.join('\n') }
}

/** An upload's line: its file as qa.file('Набор/файл') — in setInputFiles(…) or qa.dropFiles(…, …). */
const UPLOAD = /(\.setInputFiles\(|qa\.dropFiles\(.+?, )qa\.file\(('([^'/]+)\/[^']+')\)\)/
/** The scenario once per file of the set the recorded file is in: its upload takes `file`. */
function filesWrap(lines: string[]): { code: string } | { error: string } {
  if (lines.some((l) => /\bqa\.(fieldMatrix|layoutEach)\(/.test(l))) return { error: 'Сценарий уже прогоняется много раз (матрица / весь сценарий на каждом экране) — с разными файлами это не сочетается' }
  const at = lines.findIndex((l) => UPLOAD.test(l))
  if (at < 0) return { error: 'В сценарии нет загрузки файла. Запишите выбор файла («Записать» → выбрать файл в поле загрузки) — файл сохранится в «Тестовые файлы → Записанные»' }
  const m = UPLOAD.exec(lines[at])!
  const start = lines.findIndex((l) => /^\s*await\s+page\./.test(l))
  if (start < 0 || start > at) return { error: 'Перед загрузкой файла нет открытия страницы — запишите сценарий с начала' }
  const body = lines.slice(start).map((l, i) => (start + i === at ? l.replace(UPLOAD, '$1file)') : l))
  // the upload's request seen while recording («// загрузка → POST /api/…» under its line) — the run rests on it
  const up = /^\s*\/\/ загрузка → (.+?)\s*$/.exec(lines[at + 1] ?? '')?.[1]
  const out = [...lines.slice(0, start), `await qa.eachFile({ set: ${quote(m[3])}, recorded: ${m[2]}${up ? `, upload: ${quote(up)}` : ''} }, async (file) => {`, ...indent(body), `}) // шаг: Сценарий с каждым файлом набора «${m[3]}»`]
  return { code: out.join('\n') }
}
/** The set a run per file goes over (changed by the block's chooser). */
export const fileSetOf = (code: string) => /^\s*await\s+qa\.eachFile\(\{ set: '((?:\\.|[^'])*)'/m.exec(code)?.[1]?.replace(/\\(.)/g, '$1')
export const setFileSet = (code: string, set: string) =>
  code.replace(/^(\s*await\s+qa\.eachFile\(\{ set: )'(?:\\.|[^'])*'/m, `$1${quote(set)}`).replace(/(\/\/ шаг: Сценарий с каждым файлом набора «)[^»]*(»)/, `$1${set}$2`)

/** The checks in the code, in the order they run (each line — one). */
export function checksIn(code: string): QaCheckKind[] {
  const out: QaCheckKind[] = []
  for (const l of code.split('\n')) {
    const m = /^\s*await\s+qa\.(\w+)\(/.exec(l)
    // (the layout over the whole scenario — the layout check too)
    const k = m && (m[1] === 'layoutEach' ? 'layout' : (Object.keys(CALL) as QaCheckKind[]).find((x) => CALL[x] === m[1]))
    if (k) out.push(k)
  }
  return out
}
/** The code without a check (all its lines): a wrapping one — its actions back as they were recorded. */
export function unwrapCheck(code: string, kind: QaCheckKind): string {
  const lines = code.split('\n')
  const call = new RegExp(`^(\\s*)await\\s+qa\\.(?:${kind === 'layout' ? 'layout|layoutEach' : CALL[kind]})\\(`)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = call.exec(lines[i])
    if (!m) {
      out.push(lines[i])
      continue
    }
    if (kind === 'double') {
      // await qa.doubleSubmit(<locator>) — the click back
      const d = /^(\s*)await\s+qa\.doubleSubmit\((.+)\)\s*(\/\/.*)?$/.exec(lines[i])
      if (d) out.push(`${d[1]}await ${d[2]}.click()`)
      continue
    }
    if (kind === 'files') {
      // the file recorded back into its line; the body a level out
      const rec = /recorded: ('(?:\\.|[^'])*')/.exec(lines[i])?.[1]
      const pad = m[1]
      let k = i + 1
      while (k < lines.length && !new RegExp(`^${pad}\\}\\)`).test(lines[k])) k++
      for (const l of lines.slice(i + 1, k)) {
        const back = rec ? l.replace(/(\.setInputFiles\(|qa\.dropFiles\(.+?, )file\)/, `$1qa.file(${rec}))`) : l
        out.push(back.startsWith(`${pad}  `) ? pad + back.slice(pad.length + 2) : back)
      }
      i = k
      continue
    }
    if (kind === 'matrix') {
      // the fields' recorded values back into their lines; the body a level out
      const vals: Record<string, string> = {}
      let j = i + 1
      for (; j < lines.length && !/^\s*\}, async \(v\) => \{\s*$/.test(lines[j]); j++) {
        const f = /^\s*(f\d+): \{ name: '(?:\\.|[^'])*', value: (('|"|`)(?:\\.|(?!\3).)*\3), field:/.exec(lines[j])
        if (f) vals[f[1]] = f[2]
      }
      const pad = m[1]
      let k = j + 1
      while (k < lines.length && !new RegExp(`^${pad}\\}\\)`).test(lines[k])) k++
      for (const l of lines.slice(j + 1, k)) {
        const back = l.replace(/\.fill\(v\.(f\d+)\)/, (all, id: string) => (vals[id] ? `.fill(${vals[id]})` : all))
        out.push(back.startsWith(`${pad}  `) ? pad + back.slice(pad.length + 2) : back)
      }
      i = k
      continue
    }
    if (kind === 'fuzz') {
      // its JSON lines, to its closing «)»
      let j = i + 1
      while (j < lines.length && !/^\s*\)\s*(\/\/.*)?$/.test(lines[j])) j++
      i = j
      continue
    }
    if (kind === 'context') {
      // its hint line under it goes too
      if (/^\s*\/\/ ↓ запишите здесь смену/.test(lines[i + 1] ?? '')) i++
      continue
    }
    if (/=>\s*\{\s*$/.test(lines[i])) {
      // a wrapper: its body back, a level out, till its closing line
      const pad = m[1]
      let j = i + 1
      while (j < lines.length && !new RegExp(`^${pad}\\}`).test(lines[j])) j++
      for (const l of lines.slice(i + 1, j)) out.push(l.startsWith(`${pad}  `) ? pad + l.slice(pad.length + 2) : l)
      i = j
      continue
    }
    // a line of its own — gone
  }
  // «до смены» gone — its comparison means nothing
  return kind === 'context' ? unwrapCheck(out.join('\n'), 'compare') : out.join('\n')
}

/** A line that does something on the page (not the window's size, not the first opening, not a comment). */
const isAction = (l: string) => /^\s*await\s+(page\.|expect\()/.test(l) && !/page\.(setViewportSize|goto)\(/.test(l)
// (qa.window — the window line, not an action)
const lastAction = (lines: string[]) => {
  for (let i = lines.length - 1; i >= 0; i--) if (isAction(lines[i]) && !/^\s*await\s+expect\(/.test(lines[i])) return i
  return -1
}
const indent = (ls: string[]) => ls.map((l) => (l.trim() ? `  ${l}` : l))

/** The code with a check put around its actions (or after them); an error — why it cannot be (said to the person). */
export function wrapCheck(code: string, kind: QaCheckKind): { code: string } | { error: string } {
  const lines = code.replace(/\s+$/, '').split('\n')
  const all = lines.join('\n')
  // added after the actions — any time
  if (kind === 'reload') return { code: `${all}\nawait qa.sameAfterReload() // шаг: Перезагрузить страницу и сравнить, что осталось как было` }
  if (kind === 'layout') return { code: `${all}\nawait qa.layout() // шаг: Проверить вёрстку на разных экранах и масштабах` }
  if (kind === 'context')
    return {
      code: `${all}\nawait qa.snapshot('${BEFORE_SWITCH}') // шаг: Запомнить поля до смены контекста\n// ↓ запишите здесь смену контекста (компании, раздела, категории…) (кнопка «Записать» допишет сюда), затем «Проверить ▾ → Сравнить с «до смены»»`,
    }
  if (kind === 'fuzz') {
    if (/\bqa\.fuzz\(/.test(all)) return { error: 'Перебор уже есть в сценарии — его параметры в «Параметры перебора»' }
    return { code: [all, ...fuzzLines(emptyFuzz())].join('\n') }
  }
  if (kind === 'compare') {
    if (!/\bqa\.snapshot\(/.test(all)) return { error: 'Сначала «Сменить контекст: запомнить «до смены»», потом запись смены — и только тогда сравнение' }
    return { code: `${all}\nawait qa.compareWith('${BEFORE_SWITCH}') // шаг: Сравнить поля с тем, что было до смены` }
  }
  // put around the actions — one such check per scenario
  if (/\bqa\.(saveAndLeave|doubleSubmit|repeat|manyRows|fieldMatrix|eachFile)\(/.test(all)) return { error: 'В сценарии уже есть проверка, которая оборачивает действия, — уберите её или начните с чистой записи' }
  // (these find their own lines: a typing, an upload — an upload by qa.dropFiles is no page action)
  if (kind === 'matrix') return matrixWrap(lines)
  if (kind === 'files') return filesWrap(lines)
  const last = lastAction(lines)
  if (last < 0) return { error: 'В сценарии нет действий — сначала запишите их (кнопка «Записать»)' }
  if (kind === 'leave') {
    const out = [...lines.slice(0, last), 'await qa.saveAndLeave(async () => {', ...indent([lines[last]]), '}) // шаг: Сохранить и уйти со страницы — окна о несохранённых изменениях быть не должно', ...lines.slice(last + 1)]
    return { code: out.join('\n') }
  }
  if (kind === 'double') {
    const m = /^(\s*)await\s+(.+)\.click\(\)(\s*\/\/.*)?$/.exec(lines[last])
    if (!m) return { error: 'Последнее действие — не клик. Двойной клик проверяется на кнопке сохранения: запишите сценарий, который кончается нажатием на неё' }
    const out = [...lines.slice(0, last), `${m[1]}await qa.doubleSubmit(${m[2]}) // шаг: Нажать дважды подряд — второй одинаковый запрос не должен уйти`, ...lines.slice(last + 1)]
    return { code: out.join('\n') }
  }
  if (kind === 'load') {
    const out = [...lines.slice(0, last), 'await qa.manyRows(async () => {', ...indent([lines[last]]), '}, { upTo: 300 }) // шаг: Повторить действие до 300 раз и замерить, как держится страница', ...lines.slice(last + 1)]
    return { code: out.join('\n') }
  }
  // repeat: the actions after the page's opening (their checks too), twice
  const first = lines.findIndex(isAction)
  let end = lines.length - 1
  while (end > first && !isAction(lines[end])) end--
  const body = lines.slice(first, end + 1)
  const out = [...lines.slice(0, first), 'await qa.repeat(async () => {', ...indent(body), '}) // шаг: Повторить эти действия дважды', ...lines.slice(end + 1)]
  return { code: out.join('\n') }
}
