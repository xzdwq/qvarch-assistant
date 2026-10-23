/**
 * «Матрица значений полей»: a form's fields (the ones the scenario fills) tried one at a time with the values a
 * tester tries by hand — empty, spaces, too long, a wrong number / date / e-mail… — the others as recorded. Each
 * try: did the save go, what did the server say, did the form tell anything, what really went in the request.
 * The verdict is the tester's; only the clear faults are marked (a server error, a wrong value taken, a refusal
 * nobody was told of).
 */

import type { QaMark } from './browser/constants'

/** What a field is (looked at in the page before the tries). */
export interface FieldInfo {
  tag: string
  /** The input's type (text, number, date, email, tel…). */
  type: string
  inputmode?: string
  maxlength?: number
  min?: number
  max?: number
  required: boolean
  readonly: boolean
  /** A Quasar select / a native select — not typed into. */
  select: boolean
  /** Its label as the page shows it. */
  label: string
}
/** What a field takes — each kind has its typical set of values to try. */
export const FIELD_KINDS = ['text', 'number', 'date', 'email', 'phone'] as const
export type FieldKind = (typeof FIELD_KINDS)[number]
export interface MatrixCase {
  /** What it is, in words («Пусто», «На 1 больше максимума (51)»…). */
  label: string
  value: string
  /** A value a form should not take (or not as it is). */
  bad: boolean
  /** The value as an expression (a generator's call) when a literal would only be long: `gen.text(256)`. */
  expr?: string
  /** Empty in effect (nothing / only spaces): bad when the field is required. */
  empty?: boolean
}

const DATE_DMY = /^\d{2}\.\d{2}\.\d{4}$/
/** The field's kind: its type, its label's words, the value recorded into it. */
export function kindOf(info: Partial<FieldInfo>, recorded: string, name = ''): FieldKind {
  const t = (info.type ?? '').toLowerCase()
  const words = `${info.label ?? ''} ${name}`.toLowerCase()
  if (t === 'email' || /e-?mail|почт/.test(words)) return 'email'
  if (t === 'tel' || /телефон|phone/.test(words)) return 'phone'
  if (/^(date|datetime-local)$/.test(t) || /(^|[^а-яё])дат[аыеу]?([^а-яё]|$)|date/.test(words) || DATE_DMY.test(recorded) || /^\d{4}-\d{2}-\d{2}$/.test(recorded)) return 'date'
  // a name / a description is text, whatever was typed into it when recorded (a tester's «123123»)
  if (t !== 'number' && /наименован|назван|описан|коммент|примечан|адрес|артикул|код|name|title|descr|comment/.test(words)) return 'text'
  if (t === 'number' || /^(numeric|decimal)$/.test(info.inputmode ?? '') || /кол-?во|количеств|цена|стоимост|сумм|(^|[^а-яё])вес([^а-яё]|$)|процент|(^|[^а-яё])ставк|(^|[^а-яё])числ|qty|price|amount/.test(words) || /^-?\d+([.,]\d+)?$/.test(recorded.trim())) return 'number'
  return 'text'
}
const long = (n: number) => {
  const base = 'Длинный текст для проверки '
  return base.repeat(Math.ceil(n / base.length)).slice(0, n)
}
/** The values of each kind of field, after the empty ones: its own limits (min / max, maxlength) first. */
const CASES_BY_KIND: Record<FieldKind, (info: Partial<FieldInfo>, recorded: string) => MatrixCase[]> = {
  number: (info, recorded) => [
    ...(info.min !== undefined ? [{ label: `Меньше минимума (${info.min - 1})`, value: String(info.min - 1), bad: true }] : []),
    ...(info.max !== undefined ? [{ label: `Больше максимума (${info.max + 1})`, value: String(info.max + 1), bad: true }] : []),
    { label: 'Ноль', value: '0', bad: false },
    { label: 'Отрицательное', value: '-1', bad: false },
    { label: 'Дробь через запятую', value: '1,5', bad: false },
    { label: 'Дробь через точку', value: '1.5', bad: false },
    { label: 'Очень большое', value: '99999999999999', bad: false },
    { label: 'Буквы', value: 'abc', bad: true },
    { label: 'Пробелы по краям', value: ` ${recorded.trim() || '5'} `, bad: false },
  ],
  date: (_info, recorded) => {
    // (in the format the scenario typed: 31.12.2099 or 2099-12-31)
    const dmy = !/^\d{4}-/.test(recorded)
    const d = (dd: string, mm: string, yy: string) => (dmy ? `${dd}.${mm}.${yy}` : `${yy}-${mm}-${dd}`)
    return [
      { label: 'Несуществующая дата (31 февраля)', value: d('31', '02', '2024'), bad: true },
      { label: 'Нули', value: d('00', '00', '0000'), bad: true },
      { label: 'Давняя (1900)', value: d('01', '01', '1900'), bad: false },
      { label: 'Далёкая (2099)', value: d('31', '12', '2099'), bad: false },
      { label: 'Буквы', value: 'abc', bad: true },
    ]
  },
  email: () => [
    { label: 'Без домена', value: 'test@', bad: true },
    { label: 'Без точки в домене', value: 'test@example', bad: true },
    { label: 'Без @', value: 'test.example.com', bad: true },
    { label: 'Пробелы по краям', value: ' test@example.com ', bad: false },
    { label: 'Кириллица', value: 'тест@пример.рф', bad: false },
  ],
  phone: () => [
    { label: 'Слишком короткий', value: '123', bad: true },
    { label: 'Слишком длинный', value: '+7999123456789012', bad: true },
    { label: 'Со скобками и дефисами', value: '+7 (999) 123-45-67', bad: false },
    { label: 'Буквы', value: 'abc', bad: true },
  ],
  text: (info, recorded) => {
    const max = info.maxlength
    const lengths: MatrixCase[] =
      max !== undefined && max > 0 && max < 100_000
        ? [{ label: `Ровно максимум (${max})`, value: long(max), expr: `gen.text(${max})`, bad: false }, { label: `На 1 больше максимума (${max + 1})`, value: long(max + 1), expr: `gen.text(${max + 1})`, bad: true }]
        : [{ label: 'Длинный (256)', value: long(256), expr: 'gen.text(256)', bad: false }, { label: 'Очень длинный (1000)', value: long(1000), expr: 'gen.text(1000)', bad: false }]
    return [
      { label: 'Пробелы по краям', value: `  ${recorded.trim() || 'Тест'}  `, bad: false },
      { label: 'Один символ', value: 'А', bad: false },
      ...lengths,
      { label: 'Кириллица, латиница, знаки', value: 'Ёлка Test «кавычки» — №1 / 50% &', bad: false },
      { label: 'Эмодзи', value: 'Тест 😀', bad: false },
      { label: 'Ведущие нули', value: '007', bad: false },
    ]
  },
}
/** The values to try: by kind, the field's own limits (maxlength, min / max) first; at most a dozen. */
export function casesFor(kind: FieldKind, info: Partial<FieldInfo>, recorded: string): MatrixCase[] {
  const out: MatrixCase[] = [
    { label: 'Пусто', value: '', bad: false, empty: true },
    { label: 'Только пробелы', value: '   ', bad: false, empty: true },
    ...CASES_BY_KIND[kind](info, recorded),
  ]
  // the same value twice (min − 1 = 0 and «Ноль») — once, under its first name
  return out.filter((c, i) => out.findIndex((x) => x.value === c.value) === i).slice(0, 12)
}
/** The browser itself would not take the value (letters into a number input, a value a date input refuses). */
const REFUSED_BY_INPUT = /Cannot type text into input\[type=|Malformed value|Element is not an <input>|not editable/i

// ---------- what went in the request ----------
type Path = Array<string | number>
/** Every place a value is in a JSON body (at most `max`). */
export function findPaths(body: unknown, value: string, max = 5): Path[] {
  const want = value.trim()
  const out: Path[] = []
  if (!want) return out
  // a number as the server keeps it: 22 → 22.000, "22.0"
  const n = /^-?\d+([.,]\d+)?$/.test(want) ? Number(want.replace(',', '.')) : undefined
  const walk = (v: unknown, p: Path) => {
    if (out.length >= max) return
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k])
    else if (v !== null && v !== undefined && (String(v) === want || (n !== undefined && String(v).trim() !== '' && Number(v) === n))) out.push(p)
  }
  walk(body, [])
  return out
}
/** Where a value is in a JSON body (the first place it is, as a string or a number). */
export function findPath(body: unknown, value: string): Path | undefined {
  const want = value.trim()
  if (!want) return undefined
  let found: Path | undefined
  const walk = (v: unknown, p: Path) => {
    if (found) return
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...p, k])
    else if (v !== null && v !== undefined && String(v) === want) found = p
  }
  walk(body, [])
  return found
}
export function getAt(body: unknown, path: Path): { has: boolean; value?: unknown } {
  let v: unknown = body
  for (const k of path) {
    if (!v || typeof v !== 'object' || !(k in (v as Record<string | number, unknown>))) return { has: false }
    v = (v as Record<string | number, unknown>)[k]
  }
  return { has: true, value: v }
}
export const pathText = (p: Path) => p.map((k, i) => (typeof k === 'number' ? `[${k}]` : i ? `.${k}` : k)).join('')

// ---------- the verdict of a try ----------
export interface MatrixObs {
  /** The scenario stopped (a button not clickable, a field not typed into…). */
  error?: string
  /** The changes sent (POST / PUT / PATCH / DELETE) and their answers. */
  muts: Array<{ status?: number; res?: string; line: string }>
  /** What the page told (field errors, alerts, toasts). */
  hints: string[]
  /** What the field shows after the typing (a mask, maxlength). */
  shown?: string
  /** What went in the save's body at the field's place (none — the place not found / not in it). */
  sent?: { has: boolean; value?: unknown }
  /** What the field shows when the form is opened again after the save — what was stored (an edit form only). */
  stored?: string
}
/** A value as a number ('1,5' → 1.5), else undefined. */
const asNum = (s: string) => {
  const t = s.trim().replace(',', '.')
  return /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t) ? Number(t) : undefined
}
export interface MatrixVerdict {
  state: QaMark
  /** Принято / Форма не пустила / Сервер отказал / Ошибка сервера / Не сохранилось. */
  result: string
  /** Why / what was said / what went. */
  detail: string
}
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s)
const errText = (res?: string) => {
  if (!res) return ''
  try {
    const j = JSON.parse(res) as Record<string, unknown>
    const m = j.message ?? j.error ?? j.detail ?? j.title ?? (Array.isArray(j.errors) ? (j.errors as Array<Record<string, unknown>>).map((e) => e.message ?? e).join('; ') : undefined)
    if (m) return short(Array.isArray(m) ? m.join('; ') : String(m), 160)
  } catch {
    // not JSON
  }
  return short(res.replace(/\s+/g, ' ').trim(), 160)
}
export function judge(c: MatrixCase, required: boolean, obs: MatrixObs): MatrixVerdict {
  const hint = obs.hints.join(' · ')
  const bad5 = obs.muts.find((m) => (m.status ?? 0) >= 500)
  if (bad5) return { state: 'fail', result: `Ошибка сервера ${bad5.status}`, detail: errText(bad5.res) || bad5.line }
  const good = obs.muts.filter((m) => (m.status ?? 0) >= 200 && (m.status ?? 0) < 300)
  const bad4 = obs.muts.find((m) => (m.status ?? 0) >= 400)
  // (what went and what was stored are columns of their own; the field's look — only when nothing tells more)
  const shown = obs.shown !== undefined && obs.shown !== c.value && obs.stored === undefined ? `в поле стало «${short(obs.shown, 40)}»` : ''
  if (good.length && !bad4) {
    const sentEmpty = obs.sent?.has && (obs.sent.value === null || obs.sent.value === '') && c.value.trim() !== ''
    if (c.empty && required) return { state: 'warn', result: 'Принято', detail: 'пустое значение принято, а поле обязательное' }
    if (c.bad) return { state: 'warn', result: 'Принято', detail: sentEmpty ? 'форма молча заменила неверное значение на пустое и сохранила' : `неверное значение принято${shown ? `; ${shown}` : ''}` }
    // a number stored not as it was typed (rounded, cut): 99999999999999 → 100000000000000
    const typed = asNum(c.value)
    const kept = obs.stored !== undefined ? asNum(obs.stored) : undefined
    if (typed !== undefined && kept !== undefined && typed !== kept) return { state: 'warn', result: 'Принято', detail: `число сохранилось иначе: ${c.value.trim()} → ${obs.stored}` }
    if (obs.stored !== undefined && typed === undefined && obs.stored.trim() !== c.value.trim() && !(c.empty && obs.stored === '')) return { state: 'ok', result: 'Принято', detail: 'сохранилось не так, как введено — сравните колонки' }
    return { state: 'ok', result: 'Принято', detail: shown }
  }
  if (bad4) {
    const said = errText(bad4.res)
    if (!hint) return { state: 'warn', result: `Сервер отказал (${bad4.status})`, detail: `форма об этом не сказала${said ? `; сервер: ${said}` : ''}` }
    return { state: 'ok', result: `Сервер отказал (${bad4.status})`, detail: `на форме: ${short(hint, 120)}${said ? `; сервер: ${said}` : ''}` }
  }
  // nothing sent
  if (obs.error && REFUSED_BY_INPUT.test(obs.error)) return { state: 'ok', result: 'Поле не принимает', detail: 'такое значение в поле не ввести (браузер не даёт)' }
  if (hint) return { state: 'ok', result: 'Форма не пустила', detail: short(hint, 160) }
  // the scenario stopped short (not the form refusing, not the field): the try never got to its save — failed
  if (obs.error) return { state: 'fail', result: 'Сценарий не прошёл', detail: `шаг не выполнился: ${short(obs.error.split('\n')[0], 160)}` }
  return { state: 'warn', result: 'Не сохранилось', detail: `запрос не ушёл, и форма ничего не сказала${shown ? `; ${shown}` : ''}` }
}
