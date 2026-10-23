import { kv, type HttpKV } from '../http'
import type { RecFull } from './recording'

/** A recorded request read: its headers, its body, the values it carries. */

/** Headers a request must not carry over (the client sets them itself, or they break a replay). */
export const DROP_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'accept-encoding', 'proxy-connection', 'expect'])
/** Headers that hold a secret: they go into secret variables. */
export const SECRET_HEADER = /^(authorization|cookie)$|token|api[-_]?key|secret|csrf|xsrf|session/i
/** A host → a piece of a variable name: api.example.com:8080 → api_example_com_8080. */
export const hostKey = (host: string) => host.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
/** A header's value by its name (any case). */
export const headerOf = (h: Array<[string, string]>, name: string) => h.find(([k]) => k.toLowerCase() === name)?.[1]

export const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
/** Only values that mean something: not short words, not small numbers, not true / false. */
export const linkable = (v: unknown): v is string | number => (typeof v === 'string' ? v.length >= 3 && !/^(true|false|null|undefined)$/i.test(v) : typeof v === 'number' && Number.isFinite(v) && Math.abs(v) >= 10)
/** Each linkable leaf of a JSON value with its path (at most a few thousand looked at). */
export function leaves(v: unknown, path: Array<string | number>, cb: (path: Array<string | number>, v: string | number) => void, budget = { n: 5000 }): void {
  if (budget.n-- <= 0) return
  if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], cb, budget))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], cb, budget)
  else if (linkable(v)) cb(path, v)
}
/** A JSON path as the list shows it: `data.items[0].id`. */
export const pathText = (p: Array<string | number>) => p.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('').replace(/^\./, '') || '(всё тело)'
/** A text that is a JSON object / array, parsed; anything else — undefined. */
export function jsonOf(text: string | undefined): unknown {
  if (!text) return undefined
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

export type RecordedBody = { kind: 'none' } | { kind: 'json'; value: unknown } | { kind: 'rows'; mode: 'urlencoded' | 'form'; rows: HttpKV[] } | { kind: 'raw'; text: string; type: string }
/** The body a request sent: JSON, a form (urlencoded / multipart — a file's content is not in the recording), raw text. */
export function parseBody(r: RecFull): RecordedBody {
  const data = r.postData
  if (data === undefined || data === '') return { kind: 'none' }
  const ct = (headerOf(r.reqHeaders, 'content-type') ?? '').toLowerCase()
  if (ct.includes('json') || (!ct && /^\s*[[{]/.test(data))) {
    try {
      return { kind: 'json', value: JSON.parse(data) }
    } catch {
      // not JSON after all
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) return { kind: 'rows', mode: 'urlencoded', rows: [...new URLSearchParams(data)].map(([k, v]) => kv(k, v)) }
  // (the boundary as it was — it is case-sensitive)
  const bm = (headerOf(r.reqHeaders, 'content-type') ?? '').match(/multipart\/form-data;.*boundary=("?)([^";]+)\1/i)
  if (bm) {
    const rows: HttpKV[] = []
    for (const part of data.split(`--${bm[2]}`)) {
      const m = part.match(/name="([^"]*)"(?:;\s*filename="([^"]*)")?[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n?$/)
      if (!m) continue
      // a file's content is not in the recording — it has to be picked again
      rows.push(m[2] !== undefined ? kv(m[1], `«файл: ${m[2]}» — выберите заново`, false) : kv(m[1], m[3]))
    }
    return { kind: 'rows', mode: 'form', rows }
  }
  return { kind: 'raw', text: data, type: ct.split(';')[0] || 'text/plain' }
}
