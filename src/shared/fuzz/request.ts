import { DROP } from './paths'

/** A request the page sent taken apart into a tree of parameters (`body`, `query`) — and written back as it was. */

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
