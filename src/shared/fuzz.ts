/**
 * «Перебор параметров запроса»: a request the page really sent (its body, its query) taken apart into parameters;
 * each chosen one tried with values of one's own (arrays of 0 / 1 / 20 / 21… elements, empty, null, absent, long
 * strings, numbers…), the others as sent. What each answer was: its status, its time, how many were found — and
 * where it breaks («с 21 элемента»), where more values found fewer.
 */
import { apiPath } from './apiMap'

// ---------- the spec (the check's argument, JSON in the scenario's code) ----------
export interface FuzzCase {
  label: string
  /** An expression: a literal, `null`, `drop` (the parameter left out), `size(21)` (an array of 21), `gen.text(255)`… */
  value: string
}
export interface FuzzParam {
  /** Where: `body.filter.ids`, `query.filter[ids]`…, see pathOf. */
  path: string
  cases: FuzzCase[]
  /** More values — not fewer found (a filter's list of values: «одно из»). */
  monotonic?: boolean
}
export interface FuzzSpec {
  /** The request: «POST /api/items/search» (ids in the path as :id). */
  request: string
  /** Its example (the API map's) — when the scenario did not send it itself. */
  sample?: { url: string; body?: string; contentType?: string }
  /** Where «how many found» is in the answer (`meta.total`, `data`…); none — guessed. */
  found?: string
  /** An answer slower than this (ms) is marked; by default 3 s or 5× the original's time. */
  slowMs?: number
  params: FuzzParam[]
}

// ---------- a request as a tree ----------
export interface ReqParts {
  method: string
  url: string
  contentType?: string
  body?: string
}
type ArrStyle = 'index' | 'brackets' | 'repeat'
/** The request's parameters as a tree (`body`, `query`) and how to write them back as they were written. */
export interface Decoded {
  tree: { body?: unknown; query?: Record<string, unknown> }
  bodyKind?: 'json' | 'form' | 'other'
  /** Query (and form) arrays: `a[0]=`, `a[]=` or `a=&a=`. */
  arr: ArrStyle
  /** The query (form) keys whose value is JSON (`filter={"id":{"_in":[…]}}`). */
  jsonKeys: string[]
}

/** «a[b][0]» → ['a', 'b', '0']. */
const keyParts = (k: string): string[] => {
  const m = /^([^[\]]+)((?:\[[^[\]]*\])*)$/.exec(k)
  if (!m) return [k]
  return [m[1], ...[...m[2].matchAll(/\[([^[\]]*)\]/g)].map((x) => x[1])]
}
const isIndex = (s: string) => /^\d+$/.test(s)
/** A query / a form taken apart: nested keys, repeated keys as arrays, JSON values parsed. */
function parsePairs(pairs: Array<[string, string]>): { tree: Record<string, unknown>; arr: ArrStyle; jsonKeys: string[] } {
  const tree: Record<string, unknown> = {}
  let arr: ArrStyle = 'repeat'
  const jsonKeys: string[] = []
  const counts = new Map<string, number>()
  for (const [k] of pairs) counts.set(k, (counts.get(k) ?? 0) + 1)
  for (const [k, raw] of pairs) {
    const parts = keyParts(k)
    if (parts.slice(1).some(isIndex)) arr = 'index'
    else if (parts.slice(1).some((p) => p === '') && arr !== 'index') arr = 'brackets'
    let v: unknown = raw
    if (/^\s*[[{]/.test(raw) && parts.length === 1) {
      try {
        v = JSON.parse(raw)
        jsonKeys.push(k)
      } catch {
        v = raw
      }
    }
    let at: Record<string, unknown> | unknown[] = tree
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      const last = i === parts.length - 1
      const nextArr = !last && (parts[i + 1] === '' || isIndex(parts[i + 1]))
      if (Array.isArray(at)) {
        if (p === '') {
          if (last) at.push(v)
          else {
            const n: Record<string, unknown> | unknown[] = nextArr ? [] : {}
            at.push(n)
            at = n
          }
          continue
        }
        const idx = Number(p)
        if (last) at[idx] = v
        else at = (at[idx] ??= nextArr ? [] : {}) as Record<string, unknown> | unknown[]
        continue
      }
      if (last) {
        // a key repeated (a=1&a=2): an array
        if ((counts.get(k) ?? 0) > 1) {
          if (!Array.isArray(at[p])) at[p] = []
          ;(at[p] as unknown[]).push(v)
        } else at[p] = v
      } else at = (at[p] ??= nextArr ? [] : {}) as Record<string, unknown> | unknown[]
    }
  }
  return { tree, arr, jsonKeys }
}
/** The tree written back as pairs, in the style it came in. */
function writePairs(tree: Record<string, unknown>, arr: ArrStyle, jsonKeys: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const lit = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  const walk = (key: string, v: unknown, top: boolean) => {
    if (v === DROP) return
    if (top && jsonKeys.includes(key) && v !== null && typeof v === 'object') return out.push([key, JSON.stringify(v)])
    if (Array.isArray(v)) {
      if (!v.length) return
      v.forEach((x, i) => walk(arr === 'index' ? `${key}[${i}]` : arr === 'brackets' ? `${key}[]` : key, x, false))
      return
    }
    if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(`${key}[${k}]`, x, false)
      return
    }
    out.push([key, lit(v)])
  }
  for (const [k, v] of Object.entries(tree)) walk(k, v, true)
  return out
}
const enc = (pairs: Array<[string, string]>) => pairs.map(([k, v]) => `${encodeURIComponent(k).replace(/%5B/g, '[').replace(/%5D/g, ']')}=${encodeURIComponent(v)}`).join('&')

/** The request taken apart. */
export function decodeRequest(r: ReqParts): Decoded {
  const u = new URL(r.url)
  const q = parsePairs([...u.searchParams.entries()])
  const out: Decoded = { tree: {}, arr: q.arr, jsonKeys: q.jsonKeys }
  if ([...u.searchParams.keys()].length) out.tree.query = q.tree
  const ct = (r.contentType ?? '').toLowerCase()
  if (r.body !== undefined && r.body !== '') {
    if (/json/.test(ct) || (!ct && /^\s*[[{]/.test(r.body))) {
      try {
        out.tree.body = JSON.parse(r.body)
        out.bodyKind = 'json'
      } catch {
        out.bodyKind = 'other'
      }
    } else if (/x-www-form-urlencoded/.test(ct)) {
      const f = parsePairs([...new URLSearchParams(r.body).entries()])
      out.tree.body = f.tree
      out.bodyKind = 'form'
      out.jsonKeys = [...out.jsonKeys, ...f.jsonKeys]
      if (f.arr !== 'repeat') out.arr = f.arr
    } else out.bodyKind = 'other'
  }
  return out
}
/** The request with its tree written back (the address's query, the body). */
export function encodeRequest(r: ReqParts, d: Decoded, tree: Decoded['tree']): { url: string; body?: string } {
  const u = new URL(r.url)
  const url = tree.query ? `${u.origin}${u.pathname}${(() => {
    const s = enc(writePairs(tree.query, d.arr, d.jsonKeys))
    return s ? `?${s}` : ''
  })()}${u.hash}` : r.url
  if (d.bodyKind === 'json') return { url, body: tree.body === undefined ? '' : JSON.stringify(tree.body) }
  if (d.bodyKind === 'form') return { url, body: enc(writePairs((tree.body ?? {}) as Record<string, unknown>, d.arr, d.jsonKeys)) }
  return { url, body: r.body }
}

// ---------- paths ----------
export type Seg = string | number
/** «body.filter.ids», «query.filter[ids]» — the segments; a key with dots / brackets as ["…"]. */
export function parsePath(p: string): Seg[] {
  const out: Seg[] = []
  const re = /\["((?:\\.|[^"\\])*)"\]|\[(\d+)\]|\[([^\]"]*)\]|\.?([^.[\]]+)/g
  for (const m of p.matchAll(re)) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, '$1'))
    else if (m[2] !== undefined) out.push(Number(m[2]))
    else if (m[3] !== undefined) out.push(m[3])
    else if (m[4] !== undefined) out.push(m[4])
  }
  return out
}
export function pathOf(segs: Seg[]): string {
  return segs
    .map((s, i) => (typeof s === 'number' ? `[${s}]` : /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(s) ? (i ? `.${s}` : s) : `["${s.replace(/["\\]/g, '\\$&')}"]`))
    .join('')
}
export function getPath(tree: unknown, segs: Seg[]): { has: boolean; value: unknown } {
  let v: unknown = tree
  for (const s of segs) {
    if (v === null || typeof v !== 'object' || !(s in (v as object))) return { has: false, value: undefined }
    v = (v as Record<string | number, unknown>)[s]
  }
  return { has: true, value: v }
}
/** The value set at the path (a copy of the tree; DROP — the key left out). */
export function setPath<T>(tree: T, segs: Seg[], value: unknown): T {
  const root = structuredClone(tree) as unknown
  if (!segs.length) return value as T
  let at = root as Record<string | number, unknown>
  for (const s of segs.slice(0, -1)) {
    if (at[s] === null || typeof at[s] !== 'object') at[s] = {}
    at = at[s] as Record<string | number, unknown>
  }
  const last = segs[segs.length - 1]
  if (value === DROP) {
    if (Array.isArray(at) && typeof last === 'number') at.splice(last, 1)
    else delete at[last]
  } else at[last] = value
  return root as T
}

// ---------- the values ----------
/** «Leave the parameter out». */
export const DROP = Symbol.for('qa.fuzz.drop')
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

// ---------- the answer ----------
const TOTAL_KEYS = ['total', 'totalcount', 'total_count', 'filter_count', 'totalelements', 'totalitems', 'recordstotal', 'count', 'found']
const LIST_KEYS = ['data', 'items', 'rows', 'results', 'content', 'list', 'records']
/** How many were found: at the path one gave (a number, or an array's length), else guessed. */
export function foundIn(json: unknown, path?: string): { n?: number; where?: string } {
  if (path) {
    const v = getPath(json, parsePath(path))
    if (!v.has) return {}
    return { n: Array.isArray(v.value) ? v.value.length : typeof v.value === 'number' ? v.value : /^\d+$/.test(String(v.value)) ? Number(v.value) : undefined, where: path }
  }
  if (Array.isArray(json)) return { n: json.length, where: '(массив)' }
  if (!json || typeof json !== 'object') return {}
  // a total said: at the top, or under meta / pagination / data
  for (const scope of [[], ['meta'], ['pagination'], ['page'], ['data']] as string[][]) {
    const o = getPath(json, scope).value
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    for (const [k, v] of Object.entries(o)) if (TOTAL_KEYS.includes(k.toLowerCase()) && (typeof v === 'number' || /^\d+$/.test(String(v)))) return { n: Number(v), where: pathOf([...scope, k]) }
  }
  for (const [k, v] of Object.entries(json)) if (LIST_KEYS.includes(k.toLowerCase()) && Array.isArray(v)) return { n: v.length, where: k }
  const d = (json as Record<string, unknown>).data
  if (d && typeof d === 'object') for (const [k, v] of Object.entries(d)) if (LIST_KEYS.includes(k.toLowerCase()) && Array.isArray(v)) return { n: v.length, where: `data.${k}` }
  return {}
}

// ---------- the verdict ----------
export interface FuzzResult {
  param: string
  label: string
  value: string
  /** The array's size tried (size(n)). */
  size?: number
  status: number
  ms: number
  found?: number
  /** The answer's bytes. */
  bytes: number
  /** The answer is a file (an export: xlsx, csv) — `found` its rows. */
  file?: boolean
  /** A word of the server's (a failed answer's text, cut). */
  said?: string
  error?: string
}
export interface FuzzVerdict {
  state: 'ok' | 'warn' | 'fail'
  summary: string
  rows: string[][]
  marks: Array<'ok' | 'warn' | 'fail'>
}
const good = (s: number) => s >= 200 && s < 300
/** Each try judged; per parameter — where it breaks, where more values found fewer. */
export function judgeFuzz(base: { status: number; ms: number; found?: number }, results: FuzzResult[], spec: Pick<FuzzSpec, 'params' | 'slowMs'>): FuzzVerdict {
  const slow = spec.slowMs ?? Math.max(3000, base.ms * 5)
  const rows: string[][] = []
  const marks: Array<'ok' | 'warn' | 'fail'> = []
  const notes: string[] = []
  let fails = 0
  let warns = 0
  for (const p of spec.params) {
    const mine = results.filter((r) => r.param === p.path)
    const verdicts = mine.map((r) => {
      const why: string[] = []
      let m: 'ok' | 'warn' | 'fail' = 'ok'
      if (r.error || r.status === 0) ((m = 'fail'), why.push(`нет ответа${r.error ? `: ${r.error}` : ''}`))
      else if (r.status >= 500) ((m = 'fail'), why.push('ошибка сервера'))
      else if (r.status >= 400) ((m = 'warn'), why.push('сервер отказал'))
      else if (good(r.status) && r.bytes === 0) ((m = 'warn'), why.push('пустой ответ'))
      else if (good(r.status) && r.file && r.found === 0) ((m = 'warn'), why.push('пустой файл (0 строк)'))
      if (r.ms > slow) ((m = m === 'fail' ? m : 'warn'), why.push(`медленно (больше ${slow} мс)`))
      return { r, m, why }
    })
    // the border: sizes in order — the first that is not good after one that was
    const bySize = verdicts.filter((v) => v.r.size !== undefined).sort((a, b) => a.r.size! - b.r.size!)
    let border: number | undefined
    for (let i = 1; i < bySize.length; i++)
      if (good(bySize[i - 1].r.status) && bySize[i - 1].m !== 'fail' && (!good(bySize[i].r.status) || bySize[i].m === 'fail')) {
        border = bySize[i].r.size
        bySize[i].why.push('← граница')
        break
      }
    if (border !== undefined) notes.push(`${p.path}: ломается с ${border} элемент${border % 10 === 1 && border % 100 !== 11 ? 'а' : 'ов'}`)
    // more values — not fewer found
    if (p.monotonic) {
      const ok = bySize.filter((v) => good(v.r.status) && v.r.found !== undefined)
      for (let i = 1; i < ok.length; i++)
        if (ok[i].r.found! < ok[i - 1].r.found!) {
          ok[i].m = ok[i].m === 'fail' ? 'fail' : 'warn'
          ok[i].why.push(`больше значений → меньше найденных (${ok[i - 1].r.size}: ${ok[i - 1].r.found} → ${ok[i].r.size}: ${ok[i].r.found})`)
          notes.push(`${p.path}: при ${ok[i].r.size} найдено меньше, чем при ${ok[i - 1].r.size} (${ok[i].r.found} < ${ok[i - 1].r.found})`)
          break
        }
    }
    for (const v of verdicts) {
      if (v.m === 'fail') fails++
      else if (v.m === 'warn') warns++
      rows.push([p.path, v.r.label, String(v.r.status || '—'), `${v.r.ms} мс`, v.r.found === undefined ? '—' : String(v.r.found), [...v.why, v.r.said ? `«${v.r.said}»` : ''].filter(Boolean).join('; ') || 'ок'])
      marks.push(v.m)
    }
  }
  const state = fails ? 'fail' : warns || notes.length ? 'warn' : 'ok'
  const counts = `вариантов ${results.length}: ошибок ${fails}, замечаний ${warns}`
  return { state, summary: notes.length ? `${notes.join('; ')} (${counts})` : counts, rows, marks }
}

// ---------- the code: the check's line ----------
/** The endpoint a request is («POST /api/items/:id»). */
export const endpointKey = (method: string, url: string) => `${method.toUpperCase()} ${apiPath(url).path}`
const HEAD = /^\s*await\s+qa\.fuzz\(\s*$/
const TAIL = /^\s*\)\s*(\/\/.*)?$/
/** The check's spec in the code (its lines, its JSON). */
export function readFuzz(code: string): { from: number; to: number; spec: FuzzSpec } | undefined {
  const lines = code.split('\n')
  const from = lines.findIndex((l) => HEAD.test(l))
  if (from < 0) return undefined
  const to = lines.findIndex((l, i) => i > from && TAIL.test(l))
  if (to < 0) return undefined
  try {
    const spec = JSON.parse(lines.slice(from + 1, to).join('\n')) as FuzzSpec
    return { from, to, spec: { ...spec, params: Array.isArray(spec.params) ? spec.params : [] } }
  } catch {
    return undefined
  }
}
export function writeFuzz(code: string, spec: FuzzSpec): string {
  const at = readFuzz(code)
  const json = JSON.stringify(spec, null, 2).split('\n')
  if (!at) return code
  const lines = code.split('\n')
  return [...lines.slice(0, at.from + 1), ...json, ...lines.slice(at.to)].join('\n')
}
export const FUZZ_COMMENT = '// шаг: Перебор параметров запроса'
export const emptyFuzz = (): FuzzSpec => ({ request: '', params: [] })
export const fuzzLines = (spec: FuzzSpec) => ['await qa.fuzz(', ...JSON.stringify(spec, null, 2).split('\n'), `) ${FUZZ_COMMENT}`]
