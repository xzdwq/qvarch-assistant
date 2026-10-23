/**
 * Excel / CSV files for an import's tests: columns (a title, how its values are made — gen.…, its cell type, required,
 * unique, a maximum length) → a right file of N rows and files with one typical fault each (an empty required cell, a
 * text in a number, too long, a repeat, a column missing / extra / moved, only the header, empty rows, a big file,
 * numbers kept as text, the data on another sheet…), each with what it should lead to and a note. The columns can be
 * taken from a template (its header and first rows).
 */
import { exprToGen } from './gen'

export type CellType = 'auto' | 'text' | 'number' | 'date'
export interface XCol {
  title: string
  /** How a value is made: a literal or gen.… (as in the field matrix). */
  expr: string
  type: CellType
  required: boolean
  unique: boolean
  /** The most characters it may have (a fault «longer» goes one over). */
  maxLen?: number
}
export interface XSpec {
  /** The files' name (without the extension). */
  name: string
  rows: number
  format: 'xlsx' | 'csv'
  sheet: string
  columns: XCol[]
}
export const emptySpec = (): XSpec => ({
  name: 'данные',
  rows: 20,
  format: 'xlsx',
  sheet: 'Лист1',
  columns: [
    { title: 'Наименование', expr: 'gen.words(2)', type: 'auto', required: true, unique: true },
    { title: 'Количество', expr: 'gen.int(1, 100)', type: 'auto', required: true, unique: false },
    { title: 'Цена', expr: 'gen.number(1, 1000, 2)', type: 'auto', required: false, unique: false },
    { title: 'Дата', expr: 'gen.date(0)', type: 'auto', required: false, unique: false },
  ],
})

/** What the page should do with a file: take it or turn it down. */
export const EXPECTATIONS = ['ok', 'bad'] as const
export type Expectation = (typeof EXPECTATIONS)[number]
export const isExpectation = (v: string): v is Expectation => (EXPECTATIONS as readonly string[]).includes(v)

interface DefectInfo {
  id: string
  label: string
  hint: string
  /** What the page should do with such a file (none — it depends on the system: look at it). */
  expect?: Expectation
  /** Only for xlsx (a sheet, a cell's type). */
  xlsxOnly?: boolean
}
/** The faults, in the order their files are made. */
const DEFECT_LIST = [
  { id: 'empty', label: 'Пустое обязательное', hint: 'По файлу на каждую обязательную колонку: в одной строке её ячейка пустая', expect: 'bad' },
  { id: 'type', label: 'Неверный тип', hint: 'По файлу на каждую числовую / дату колонку: в одной строке текст «abc»', expect: 'bad' },
  { id: 'long', label: 'Длиннее максимума', hint: 'По файлу на каждую колонку с «макс. длиной»: значение на 1 символ длиннее', expect: 'bad' },
  { id: 'dup', label: 'Повтор уникального', hint: 'По файлу на каждую уникальную колонку: две строки с одинаковым значением', expect: 'bad' },
  { id: 'nocol', label: 'Нет обязательной колонки', hint: 'Первой обязательной колонки нет совсем', expect: 'bad' },
  { id: 'header', label: 'Только заголовок', hint: 'Строк с данными нет', expect: 'bad' },
  { id: 'extra', label: 'Лишняя колонка', hint: 'Справа колонка, которой нет в шаблоне' },
  { id: 'order', label: 'Колонки в другом порядке', hint: 'Те же колонки в обратном порядке' },
  { id: 'title', label: 'Заголовки иначе', hint: 'Заголовки в другом регистре и с пробелами по краям' },
  { id: 'blank', label: 'Пустые строки в середине', hint: 'Между строками данных — пустые' },
  { id: 'spaces', label: 'Пробелы по краям', hint: 'Значения текстовых колонок с пробелами в начале и в конце' },
  { id: 'textnum', label: 'Числа и даты текстом', hint: 'Числа и даты записаны в ячейки как текст (так бывает после копирования)', xlsxOnly: true },
  { id: 'sheet2', label: 'Данные на втором листе', hint: 'Первый лист пустой, данные — на втором', xlsxOnly: true },
  { id: 'big', label: 'Большой файл', hint: '10 000 строк корректных данных — скорость и ограничения импорта', expect: 'ok' },
] as const satisfies readonly DefectInfo[]
export type DefectId = (typeof DEFECT_LIST)[number]['id']
export interface XDefect extends DefectInfo {
  id: DefectId
}
export const DEFECTS: readonly XDefect[] = DEFECT_LIST

// ---------- the cells ----------
export type Cell = { v: string | number | Date | null; t: 'text' | 'number' | 'date' }
export interface XSheet {
  name: string
  header: string[]
  rows: Cell[][]
  /** Numbers and dates written as text. */
  asText?: boolean
}
export interface XFile {
  name: string
  expect?: Expectation
  note: string
  sheets: XSheet[]
}
/** The column's cell type: as set, else by how its values are made. */
export function typeOf(c: XCol): 'text' | 'number' | 'date' {
  if (c.type !== 'auto') return c.type
  const g = exprToGen(c.expr).id
  return g === 'int' || g === 'number' ? 'number' : g === 'date' ? 'date' : 'text'
}
/** A text value as a date (dd.MM.yyyy, yyyy-MM-dd, ISO), else undefined. */
export function asDate(s: string): Date | undefined {
  let m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return undefined
}
function cellOf(c: XCol, raw: string): Cell {
  const t = typeOf(c)
  if (raw === '') return { v: null, t }
  if (t === 'number') {
    const n = Number(raw.replace(',', '.'))
    return Number.isFinite(n) ? { v: n, t } : { v: raw, t: 'text' }
  }
  if (t === 'date') {
    const d = asDate(raw)
    return d ? { v: d, t } : { v: raw, t: 'text' }
  }
  return { v: raw, t: 'text' }
}
const textCell = (v: string): Cell => ({ v, t: 'text' })

/** The rows of a spec: each column's values made (a unique one — none twice). */
export function makeRows(spec: XSpec, n: number, make: (expr: string) => string): Cell[][] {
  const seen = spec.columns.map(() => new Set<string>())
  return Array.from({ length: n }, (_, r) =>
    spec.columns.map((c, i) => {
      let v = make(c.expr)
      if (c.unique) {
        for (let k = 0; k < 5 && seen[i].has(v); k++) v = make(c.expr)
        if (seen[i].has(v)) v = `${v} ${r + 1}`
        seen[i].add(v)
      }
      if (c.maxLen && v.length > c.maxLen) v = v.slice(0, c.maxLen)
      return cellOf(c, v)
    }),
  )
}
const clone = (rows: Cell[][]) => rows.map((r) => r.map((c) => ({ ...c })))

/** What a fault's builder sees: the spec, the right rows and how to wrap rows into the sheet. */
interface DefectContext {
  spec: XSpec
  header: string[]
  base: Cell[][]
  /** The faulty row's index and its line in the file (after the header, from 1). */
  at: number
  line: number
  sheet: (rows: Cell[][], header?: string[], extra?: Partial<XSheet>) => XSheet[]
  make: (expr: string) => string
}
/** One faulty file before it gets the spec's name and the fault's expectation. */
interface DefectFile {
  suffix: string
  note: string
  sheets: XSheet[]
}
type DefectBuilder = (ctx: DefectContext) => DefectFile[]

/** A file per column the predicate picks, each with its own rows changed. */
const perColumn = (ctx: DefectContext, build: (c: XCol, i: number) => DefectFile | undefined): DefectFile[] =>
  ctx.spec.columns.flatMap((c, i) => build(c, i) ?? [])
const emptyRow = (spec: XSpec): Cell[] => spec.columns.map((c) => ({ v: null, t: typeOf(c) }))

/** How each fault's files are made. */
const DEFECT_BUILDERS: Record<DefectId, DefectBuilder> = {
  empty: (ctx) =>
    perColumn(ctx, (c, i) => {
      if (!c.required) return undefined
      const rows = clone(ctx.base)
      rows[ctx.at][i] = { v: null, t: typeOf(c) }
      return { suffix: `пусто «${c.title}»`, note: `пустая «${c.title}» в строке ${ctx.line}`, sheets: ctx.sheet(rows) }
    }),
  type: (ctx) =>
    perColumn(ctx, (c, i) => {
      const t = typeOf(c)
      if (t === 'text') return undefined
      const rows = clone(ctx.base)
      rows[ctx.at][i] = textCell('abc')
      return { suffix: `текст в «${c.title}»`, note: `«abc» в ${t === 'number' ? 'числовой' : 'дате'} «${c.title}», строка ${ctx.line}`, sheets: ctx.sheet(rows) }
    }),
  long: (ctx) =>
    perColumn(ctx, (c, i) => {
      if (!c.maxLen) return undefined
      const rows = clone(ctx.base)
      rows[ctx.at][i] = textCell('Ж'.repeat(c.maxLen + 1))
      return { suffix: `длинное «${c.title}»`, note: `«${c.title}» в строке ${ctx.line}: ${c.maxLen + 1} символов при максимуме ${c.maxLen}`, sheets: ctx.sheet(rows) }
    }),
  dup: (ctx) =>
    perColumn(ctx, (c, i) => {
      if (!c.unique || ctx.base.length < 2) return undefined
      const rows = clone(ctx.base)
      rows[1][i] = { ...rows[0][i] }
      return { suffix: `повтор «${c.title}»`, note: `«${c.title}» в строках 2 и 3 одинаковое`, sheets: ctx.sheet(rows) }
    }),
  nocol: ({ spec, base, header, sheet }) => {
    const i = spec.columns.findIndex((c) => c.required)
    if (i < 0) return []
    const without = <T>(xs: T[]) => xs.filter((_, j) => j !== i)
    const title = spec.columns[i].title
    return [{ suffix: `нет «${title}»`, note: `колонки «${title}» нет`, sheets: sheet(clone(base).map(without), without(header)) }]
  },
  header: ({ sheet }) => [{ suffix: 'только заголовок', note: 'строк с данными нет', sheets: sheet([]) }],
  extra: ({ base, header, sheet }) => [
    { suffix: 'лишняя колонка', note: 'справа колонка «Лишняя»', sheets: sheet(clone(base).map((r) => [...r, textCell('лишнее')]), [...header, 'Лишняя']) },
  ],
  order: ({ base, header, sheet }) => [
    { suffix: 'другой порядок', note: 'колонки в обратном порядке', sheets: sheet(clone(base).map((r) => [...r].reverse()), [...header].reverse()) },
  ],
  title: ({ base, header, sheet }) => [
    { suffix: 'заголовки иначе', note: 'заголовки в верхнем регистре с пробелами по краям', sheets: sheet(clone(base), header.map((h) => ` ${h.toUpperCase()} `)) },
  ],
  blank: ({ spec, base, sheet }) => {
    // an empty row after every third one, never after the last
    const rows = clone(base).flatMap((r, i) => (i % 3 === 0 && i < base.length - 1 ? [r, emptyRow(spec)] : [r]))
    return [{ suffix: 'пустые строки', note: 'между строками данных пустые', sheets: sheet(rows) }]
  },
  spaces: ({ base, sheet }) => [
    {
      suffix: 'пробелы по краям',
      note: 'текстовые значения с пробелами в начале и в конце',
      sheets: sheet(clone(base).map((r) => r.map((c) => (c.t === 'text' && typeof c.v === 'string' ? { ...c, v: `  ${c.v}  ` } : c)))),
    },
  ],
  textnum: ({ base, header, sheet }) => [{ suffix: 'числа текстом', note: 'числа и даты — текстом в ячейках', sheets: sheet(clone(base), header, { asText: true }) }],
  sheet2: ({ base, sheet }) => [{ suffix: 'второй лист', note: 'первый лист пустой, данные на втором', sheets: [{ name: 'Пустой', header: [], rows: [] }, ...sheet(clone(base))] }],
  big: ({ spec, sheet, make }) => [{ suffix: '10000 строк', note: 'большой файл: 10 000 строк', sheets: sheet(makeRows(spec, 10_000, make)) }],
}

/** The files: the right one, and one per fault (and per column where the fault is a column's). */
export function makeFiles(spec: XSpec, defects: readonly string[], make: (expr: string) => string): XFile[] {
  const header = spec.columns.map((c) => c.title)
  const n = Math.max(1, Math.min(100_000, Math.round(spec.rows) || 1))
  const base = makeRows(spec, n, make)
  // the faulty row: the second (a first row is often looked at more closely than the rest)
  const at = Math.min(1, base.length - 1)
  const sheet = (rows: Cell[][], h = header, extra: Partial<XSheet> = {}): XSheet[] => [{ name: spec.sheet || 'Лист1', header: h, rows, ...extra }]
  const ctx: DefectContext = { spec, header, base, at, line: at + 2, sheet, make }
  const want = new Set(defects)
  const faulty = DEFECTS.filter((d) => want.has(d.id) && (!d.xlsxOnly || spec.format === 'xlsx')).flatMap((d) =>
    DEFECT_BUILDERS[d.id](ctx).map((f): XFile => ({ name: `${spec.name} — ${f.suffix}`, ...(d.expect ? { expect: d.expect } : {}), note: f.note, sheets: f.sheets })),
  )
  return [{ name: spec.name, expect: 'ok', note: `корректный: ${n} строк`, sheets: sheet(base) }, ...faulty]
}

// ---------- the columns from a template ----------
const isNum = (s: string) => /^-?\d+([.,]\d+)?$/.test(s.trim())
/** A column guessed from its title and the values under it. */
export function guessColumn(title: string, samples: string[]): XCol {
  const vals = samples.map((s) => s.trim()).filter(Boolean)
  const required = vals.length > 0 && vals.length === samples.length
  const base = { title, type: 'auto' as CellType, required, unique: false }
  const words = title.toLowerCase()
  if (!vals.length) return { ...base, expr: 'gen.words(2)' }
  if (vals.every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))) return { ...base, unique: true, expr: 'gen.uuid()' }
  if (vals.every((v) => /^[^@\s]+@[^@\s]+\.\w+$/.test(v))) return { ...base, expr: 'gen.email()' }
  if (vals.every((v) => /^\d{2}\.\d{2}\.\d{4}/.test(v))) return { ...base, expr: 'gen.date(0)' }
  if (vals.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return { ...base, expr: "gen.date(0, 'yyyy-MM-dd')" }
  if (vals.every(isNum) && !/код|артикул|телефон|инн|code|phone/.test(words)) {
    const nums = vals.map((v) => Number(v.replace(',', '.')))
    const max = Math.max(...nums)
    const top = Math.max(10, Math.ceil(max * 2))
    if (nums.every(Number.isInteger)) return { ...base, expr: `gen.int(${Math.min(0, ...nums) < 0 ? -top : 1}, ${top})` }
    const dec = Math.max(...vals.map((v) => (v.split(/[.,]/)[1] ?? '').length))
    return { ...base, expr: `gen.number(0, ${top}, ${dec || 2}${vals.some((v) => v.includes(',')) ? ', true' : ''})` }
  }
  if (vals.every((v) => /^[\d\s()+-]{7,}$/.test(v)) && /тел|phone/.test(words)) return { ...base, expr: 'gen.phone()' }
  // a few repeated values (units, statuses): one of them
  const kinds = [...new Set(vals)]
  if (vals.length >= 3 && kinds.length <= Math.ceil(vals.length / 2) && kinds.every((k) => k.length <= 30)) return { ...base, expr: `gen.oneOf(${kinds.map((k) => `'${k.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')})` }
  // a code (letters and digits, no spaces): by its look
  if (vals.every((v) => /^[A-Za-zА-Яа-я0-9-]+$/.test(v) && /\d/.test(v))) {
    const v = vals[0]
    const pat = v.replace(/[0-9]/g, '#').replace(/[A-ZА-Я]/g, 'A').replace(/[a-zа-я]/g, 'a')
    return { ...base, unique: true, expr: `gen.pattern('${pat}')` }
  }
  const len = Math.max(...vals.map((v) => v.length))
  const wordsIn = Math.max(...vals.map((v) => v.split(/\s+/).length))
  return { ...base, unique: /наименован|назван|name/.test(words), expr: wordsIn > 1 ? `gen.words(${wordsIn})` : `gen.text(${Math.max(3, len)}, '${/[а-яё]/i.test(vals.join('')) ? 'ru' : 'en'}')` }
}
