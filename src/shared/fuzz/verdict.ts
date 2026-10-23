import { getPath, parsePath, pathOf } from './paths'
import type { FuzzSpec } from './spec'
import type { QaMark } from '../browser/constants'

/** The answers judged: how many each found, where a parameter breaks, where more values found fewer. */

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
  state: QaMark
  summary: string
  rows: string[][]
  marks: QaMark[]
}
const good = (s: number) => s >= 200 && s < 300
/** What an answer says of a try (the first rule that fits; none — fine). */
const ANSWER_RULES: ReadonlyArray<{ when: (r: FuzzResult) => boolean; mark: QaMark; why: (r: FuzzResult) => string }> = [
  { when: (r) => !!r.error || r.status === 0, mark: 'fail', why: (r) => `нет ответа${r.error ? `: ${r.error}` : ''}` },
  { when: (r) => r.status >= 500, mark: 'fail', why: () => 'ошибка сервера' },
  { when: (r) => r.status >= 400, mark: 'warn', why: () => 'сервер отказал' },
  { when: (r) => good(r.status) && r.bytes === 0, mark: 'warn', why: () => 'пустой ответ' },
  { when: (r) => good(r.status) && !!r.file && r.found === 0, mark: 'warn', why: () => 'пустой файл (0 строк)' },
]
/** Each try judged; per parameter — where it breaks, where more values found fewer. */
export function judgeFuzz(base: { status: number; ms: number; found?: number }, results: FuzzResult[], spec: Pick<FuzzSpec, 'params' | 'slowMs'>): FuzzVerdict {
  const slow = spec.slowMs ?? Math.max(3000, base.ms * 5)
  const rows: string[][] = []
  const marks: QaMark[] = []
  const notes: string[] = []
  let fails = 0
  let warns = 0
  for (const p of spec.params) {
    const mine = results.filter((r) => r.param === p.path)
    const verdicts = mine.map((r) => {
      const rule = ANSWER_RULES.find((x) => x.when(r))
      const why: string[] = rule ? [rule.why(r)] : []
      let m: QaMark = rule?.mark ?? 'ok'
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
