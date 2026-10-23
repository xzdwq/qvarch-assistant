import { DROP, pathOf, type Seg } from './paths'
import type { Decoded } from './request'
import type { FuzzCase } from './spec'

/** The values a parameter is tried with: its kind, the parameters to offer, a case's expression worked out, the typical sets. */

export type ParamKind = 'array' | 'string' | 'number' | 'boolean' | 'null' | 'object'
export const kindOfValue = (v: unknown): ParamKind => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v === 'object' ? 'object' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : /^-?\d+([.,]\d+)?$/.test(String(v)) ? 'number' : 'string')
/** The parameters one could try: every leaf and every array (an array's elements are not each a parameter). */
export function paramsOf(d: Decoded): Array<{ path: string; kind: ParamKind; sample: string }> {
  const out: Array<{ path: string; kind: ParamKind; sample: string }> = []
  const show = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > 60 ? `${s.slice(0, 57)}…` : s
  }
  const walk = (v: unknown, segs: Seg[]) => {
    if (out.length >= 300) return
    const kind = kindOfValue(v)
    if (kind === 'object') {
      // (an object itself — a period {from, to}: emptied whole)
      if (segs.length > 1) out.push({ path: pathOf(segs), kind, sample: show(v) })
      for (const [k, x] of Object.entries(v as object)) walk(x, [...segs, k])
      return
    }
    out.push({ path: pathOf(segs), kind, sample: show(v) })
  }
  if (d.tree.query) walk(d.tree.query, ['query'])
  if (d.tree.body !== undefined) walk(d.tree.body, ['body'])
  return out
}
/** An array of n: the original's elements over and over (none — 1, 2, 3…), or as `el` makes them. */
export function sized(orig: unknown, n: number, el?: unknown): unknown[] {
  const src = Array.isArray(orig) && orig.length ? orig : undefined
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => (typeof el === 'function' ? (el as (i: number) => unknown)(i) : el !== undefined ? el : src ? src[i % src.length] : i + 1))
}
/** A case's expression worked out: `orig` — the value sent; size(n), drop, gen.… at hand. */
export function evalCase(expr: string, orig: unknown, gen: unknown): unknown {
  const size = (n: number, el?: unknown) => sized(orig, n, el)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('orig', 'size', 'drop', 'gen', `return (${expr.trim() || "''"})`)(orig, size, DROP, gen)
}
/** The array's size a case gives (size(21) → 21) — for the border and «больше значений». */
export const sizeOfCase = (expr: string): number | undefined => {
  const m = /^\s*size\(\s*(\d+)\s*[,)]/.exec(expr)
  return m ? Number(m[1]) : undefined
}

/** Typical sets (the editor adds them as rows; nothing is tried by itself). */
export const FUZZ_SETS: Array<{ id: string; title: string; kinds: ParamKind[]; cases: FuzzCase[]; monotonic?: boolean }> = [
  {
    id: 'size',
    title: 'Размер массива',
    kinds: ['array'],
    monotonic: true,
    cases: [0, 1, 20, 21, 22, 100].map((n) => ({ label: `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'элемент' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'элемента' : 'элементов'}`, value: `size(${n})` })),
  },
  {
    id: 'empty',
    title: 'Пусто / null / нет',
    kinds: ['array', 'string', 'number', 'boolean', 'null', 'object'],
    cases: [
      { label: 'Пустая строка', value: "''" },
      { label: 'null', value: 'null' },
      { label: 'Параметра нет', value: 'drop' },
    ],
  },
  {
    id: 'period',
    title: 'Пустой период / объект',
    kinds: ['object', 'null'],
    cases: [
      { label: 'Пустой объект', value: '{}' },
      { label: 'Период без дат', value: '{ from: null, to: null }' },
    ],
  },
  {
    id: 'string',
    title: 'Строки',
    kinds: ['string', 'null'],
    cases: [
      { label: 'Строка 255', value: 'gen.text(255)' },
      { label: 'Строка 450', value: 'gen.text(450)' },
      { label: 'Строка 1000', value: 'gen.text(1000)' },
      { label: 'Кириллица и спецсимволы', value: "'Ёлка «кавычки» — №1 / 50% & <b> \\' \"'" },
      { label: '«не указан»', value: "'не указан'" },
    ],
  },
  {
    id: 'number',
    title: 'Числа',
    kinds: ['number', 'string'],
    cases: [
      { label: 'Целое без запятой', value: '5' },
      { label: 'Дробь через запятую (строкой)', value: "'1,5'" },
      { label: '20 + 8 знаков', value: "'12345678901234567890.12345678'" },
      { label: 'Отрицательное', value: '-1' },
      { label: 'Ноль', value: '0' },
    ],
  },
  {
    id: 'code',
    title: 'Коды',
    kinds: ['string', 'number'],
    cases: [
      { label: 'Ведущие нули', value: "'000123'" },
      { label: 'Похож на дату (2024-01-31)', value: "'2024-01-31'" },
      { label: 'Похож на дату (31.01.2024)', value: "'31.01.2024'" },
    ],
  },
]
