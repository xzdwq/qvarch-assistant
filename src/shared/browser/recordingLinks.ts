import { DROP_HEADERS, jsonOf, leaves, parseBody, pathText, safeDecode } from './recordedRequest'
import type { RecFull } from './recording'

/** A place in a request where a value from an earlier answer turned up. */
export interface LinkUse {
  /** The request (its index in the chain). */
  to: number
  where: 'path' | 'query' | 'body' | 'header'
  /** The param / header / body path, for the list. */
  key: string
}
/** A value an answer gave and later requests used: a script takes it from the answer, they get {{var}}. */
export interface RecLink {
  value: string
  /** The answer it came from (index in the chain). */
  from: number
  /** Its place in that answer's JSON. */
  path: Array<string | number>
  varName: string
  uses: LinkUse[]
  on: boolean
}

type Slot = { where: LinkUse['where']; key: string; value: string }
/** The values a request sends: path segments, query values, JSON body leaves, form values, headers. */
function slotsOf(r: RecFull): Slot[] {
  const out: Slot[] = []
  let u: URL
  try {
    u = new URL(r.url)
  } catch {
    return out
  }
  u.pathname.split('/').forEach((seg, i) => seg && out.push({ where: 'path', key: `сегмент ${i}`, value: safeDecode(seg) }))
  for (const [k, v] of u.searchParams) out.push({ where: 'query', key: k, value: v })
  const body = parseBody(r)
  if (body.kind === 'json') leaves(body.value, [], (p, v) => out.push({ where: 'body', key: pathText(p), value: String(v) }))
  else if (body.kind === 'rows') for (const x of body.rows) out.push({ where: 'body', key: x.key, value: x.value })
  for (const [k, v] of r.reqHeaders) if (!k.startsWith(':') && !DROP_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'cookie') out.push({ where: 'header', key: k, value: v.replace(/^Bearer\s+/i, '') })
  return out
}
/** `res.json().data.items[0].id` — how a script reaches a place of the answer. */
export function accessor(p: Array<string | number>): string {
  return `res.json()${p.map((k) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)).join('')}`
}

/**
 * The links of a chain: a value an answer gave (not one the page had sent before) that a later request sends —
 * an id made by a POST and then opened, a token from a login. The newest answer holding it is its source.
 */
export function findLinks(items: RecFull[]): RecLink[] {
  const sent = new Set<string>()
  const fromAnswers = new Map<string, { from: number; path: Array<string | number> }>()
  const links = new Map<string, RecLink>()
  items.forEach((r, j) => {
    const slots = slotsOf(r)
    for (const s of slots) {
      const src = fromAnswers.get(s.value)
      if (!src) continue
      const key = `${src.from}|${s.value}`
      let l = links.get(key)
      if (!l) {
        const last = [...src.path].reverse().find((k) => typeof k === 'string') as string | undefined
        const base = (last ?? 'value').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'value'
        l = { value: s.value, from: src.from, path: src.path, varName: `${base}_${src.from + 1}`, uses: [], on: true }
        links.set(key, l)
      }
      if (!l.uses.some((u) => u.to === j && u.where === s.where && u.key === s.key)) l.uses.push({ to: j, where: s.where, key: s.key })
    }
    for (const s of slots) sent.add(s.value)
    leaves(jsonOf(r.resBody), [], (p, v) => {
      const s = String(v)
      if (!sent.has(s)) fromAnswers.set(s, { from: j, path: p })
    })
  })
  // one name per variable (two values from one answer may end on the same key)
  const out = [...links.values()]
  const used = new Map<string, number>()
  for (const l of out) {
    const n = used.get(l.varName) ?? 0
    used.set(l.varName, n + 1)
    if (n) l.varName = `${l.varName}_${n + 1}`
  }
  return out
}
