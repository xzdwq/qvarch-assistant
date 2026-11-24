import type { TechHit } from './types'

/**
 * The site's technologies by the fingerprints of the Wappalyzer format (the webappanalyzer set, GPL-3.0): each
 * technology's patterns against what the page shows — its address, HTML, text, scripts' addresses, XHR hosts,
 * headers, cookies, <meta>, JS globals, DOM — with versions, confidence, and the rules between them (implies,
 * requires, excludes). The probes the page must answer (globals, selectors) come from the set too.
 */

/** A technology as the set writes it (the fields read here). */
export interface RawTech {
  cats?: number[]
  website?: string
  description?: string
  url?: string | string[]
  html?: string | string[]
  text?: string | string[]
  scriptSrc?: string | string[]
  xhr?: string | string[]
  headers?: Record<string, string>
  cookies?: Record<string, string>
  meta?: Record<string, string | string[]>
  js?: Record<string, string>
  dom?: string | string[] | Record<string, DomRule>
  implies?: string | string[]
  requires?: string | string[]
  requiresCategory?: number | number[]
  excludes?: string | string[]
}
export interface DomRule {
  exists?: string
  text?: string
  attributes?: Record<string, string>
  properties?: Record<string, string>
}
/** What the page shows, gathered for the match. */
export interface TechSignals {
  url: string
  html: string
  text: string
  scriptSrc: string[]
  xhr: string[]
  headers: Record<string, string>
  cookies: Record<string, string>
  meta: Record<string, string[]>
  /** A global's chain → its value as text ('' — an object: it is there). */
  js: Record<string, string>
  /** A selector → found: its first element's text, the attributes and properties asked. */
  dom: Record<string, { text?: string; attributes?: Record<string, string>; properties?: Record<string, string> }>
}
/** What the page is asked: the globals to read, the selectors to look for (with the attributes / properties to read). */
export interface ProbePlan {
  js: string[]
  dom: Array<{ s: string; a?: string[]; p?: string[]; t?: boolean }>
}

/** A pattern as written: the regex (case-insensitive), its version template, its confidence. */
interface Pattern {
  re: RegExp | undefined
  version?: string
  confidence: number
}
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const cache = new Map<string, Pattern>()
/** `regex\;version:\1\;confidence:50` read (a regex that does not compile in JS — never matches). */
export function parsePattern(s: string): Pattern {
  const had = cache.get(s)
  if (had) return had
  const [re, ...tags] = s.split('\\;')
  const p: Pattern = { re: undefined, confidence: 100 }
  try {
    p.re = new RegExp(re, 'i')
  } catch {
    p.re = /(?!)/
  }
  for (const t of tags) {
    const i = t.indexOf(':')
    const k = t.slice(0, i)
    const v = t.slice(i + 1)
    if (k === 'version') p.version = v
    else if (k === 'confidence') p.confidence = Number(v) || 0
  }
  cache.set(s, p)
  return p
}
/** A version from its template and the match: \1… put in; `\1?a:b` — a when the group matched, else b. */
export function versionOf(tpl: string | undefined, m: RegExpExecArray): string {
  if (!tpl) return ''
  let v = tpl
  for (let i = 1; i <= 9; i++) {
    const g = m[i] ?? ''
    v = v.replace(new RegExp(`\\\\${i}\\?([^:]*):(.*)$`), (_x, a: string, b: string) => (g ? a : b)).replace(new RegExp(`\\\\${i}`, 'g'), g)
  }
  return v.trim()
}

type Found = { confidence: number; version: string; by: Set<string> }

/** What the page must be asked for, from the whole set (computed once). */
export function probePlan(techs: Record<string, RawTech>): ProbePlan {
  const js = new Set<string>()
  const dom = new Map<string, { s: string; a: Set<string>; p: Set<string>; t: boolean }>()
  const ask = (s: string) => dom.get(s) ?? dom.set(s, { s, a: new Set(), p: new Set(), t: false }).get(s)!
  for (const t of Object.values(techs)) {
    for (const k of Object.keys(t.js ?? {})) js.add(k)
    const d = t.dom
    if (typeof d === 'string' || Array.isArray(d)) for (const s of arr(d)) ask(s)
    else if (d)
      for (const [s, r] of Object.entries(d)) {
        const q = ask(s)
        for (const a of Object.keys(r.attributes ?? {})) q.a.add(a)
        for (const p of Object.keys(r.properties ?? {})) q.p.add(p)
        if (r.text !== undefined) q.t = true
      }
  }
  return { js: [...js], dom: [...dom.values()].map((q) => ({ s: q.s, ...(q.a.size ? { a: [...q.a] } : {}), ...(q.p.size ? { p: [...q.p] } : {}), ...(q.t ? { t: true } : {}) })) }
}

/** The technologies the page shows, by the set; their categories named (`cats` — id → name). */
export function detectTech(techs: Record<string, RawTech>, cats: Record<string, { name: string }>, sig: TechSignals): TechHit[] {
  const found = new Map<string, Found>()
  const hit = (name: string, by: string, pattern: string, value: string) => {
    const p = parsePattern(pattern)
    if (!p.re) return
    p.re.lastIndex = 0
    const m = p.re.exec(value)
    if (!m) return
    const f = found.get(name) ?? { confidence: 0, version: '', by: new Set<string>() }
    f.confidence = Math.min(100, f.confidence + p.confidence)
    const v = versionOf(p.version, m)
    if (v && (!f.version || v.length > f.version.length)) f.version = v
    f.by.add(by)
    found.set(name, f)
  }
  const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]))
  const headers = lower(sig.headers)
  const meta = Object.fromEntries(Object.entries(sig.meta).map(([k, v]) => [k.toLowerCase(), v]))
  for (const [name, t] of Object.entries(techs)) {
    for (const p of arr(t.url)) hit(name, 'url', p, sig.url)
    for (const p of arr(t.html)) hit(name, 'html', p, sig.html)
    for (const p of arr(t.text)) hit(name, 'text', p, sig.text)
    for (const p of arr(t.scriptSrc)) for (const s of sig.scriptSrc) hit(name, 'scripts', p, s)
    for (const p of arr(t.xhr)) for (const s of sig.xhr) hit(name, 'xhr', p, s)
    for (const [h, p] of Object.entries(t.headers ?? {})) if (headers[h.toLowerCase()] !== undefined) hit(name, 'headers', p, headers[h.toLowerCase()])
    for (const [c, p] of Object.entries(t.cookies ?? {})) if (sig.cookies[c] !== undefined) hit(name, 'cookies', p, sig.cookies[c])
    for (const [m, ps] of Object.entries(t.meta ?? {})) for (const v of meta[m.toLowerCase()] ?? []) for (const p of arr(ps)) hit(name, 'meta', p, v)
    for (const [k, p] of Object.entries(t.js ?? {})) if (sig.js[k] !== undefined) hit(name, 'js', p, sig.js[k])
    const d = t.dom
    if (typeof d === 'string' || Array.isArray(d)) {
      for (const s of arr(d)) if (sig.dom[s]) hit(name, 'dom', '', '')
    } else if (d)
      for (const [s, r] of Object.entries(d)) {
        const el = sig.dom[s]
        if (!el) continue
        if (r.exists !== undefined) hit(name, 'dom', r.exists, '')
        if (r.text !== undefined && el.text !== undefined) hit(name, 'dom', r.text, el.text)
        for (const [a, p] of Object.entries(r.attributes ?? {})) if (el.attributes?.[a] !== undefined) hit(name, 'dom', p, el.attributes[a])
        for (const [pr, p] of Object.entries(r.properties ?? {})) if (el.properties?.[pr] !== undefined) hit(name, 'dom', p, el.properties[pr])
      }
  }
  // what the ones found imply (with their own confidence), then the rules between them
  const queue = [...found.keys()]
  while (queue.length) {
    const name = queue.shift()!
    for (const imp of arr(techs[name]?.implies)) {
      const p = parsePattern(imp)
      const [other] = imp.split('\\;')
      if (!techs[other]) continue
      const f = found.get(other)
      if (f) {
        f.by.add(`от ${name}`)
        continue
      }
      found.set(other, { confidence: Math.min(found.get(name)!.confidence, p.confidence), version: '', by: new Set([`от ${name}`]) })
      queue.push(other)
    }
  }
  const catsOf = (name: string) => arr(techs[name]?.cats).map((c) => cats[String(c)]?.name ?? String(c))
  for (const [name] of [...found]) {
    const t = techs[name]
    const needs = arr(t.requires).some((r) => !found.has(r))
    const needsCat = arr(t.requiresCategory).length > 0 && ![...found.keys()].some((n) => n !== name && arr(techs[n]?.cats).some((c) => arr(t.requiresCategory).includes(c)))
    if (needs || needsCat) found.delete(name)
  }
  for (const [name] of [...found]) for (const ex of arr(techs[name]?.excludes)) found.delete(ex)
  return [...found]
    .filter(([, f]) => f.confidence > 0)
    .map(([name, f]) => ({ name, ...(f.version ? { version: f.version } : {}), cats: catsOf(name), confidence: f.confidence, ...(techs[name].website ? { website: techs[name].website } : {}), ...(techs[name].description ? { description: techs[name].description } : {}), by: [...f.by] }))
    .sort((a, b) => a.cats.join().localeCompare(b.cats.join()) || a.name.localeCompare(b.name))
}
