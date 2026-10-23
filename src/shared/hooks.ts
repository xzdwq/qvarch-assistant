/**
 * Hooks of the Браузер: each one is tied to a site — its CSS and its JS go onto every page there (hide a banner,
 * switch something off), and it can look into the site's answers (fetch / XHR, HTML, scripts…) for a text or a
 * regular expression, in a process of its own; what it finds is kept.
 */
/** The kinds of answers a hook's search looks into (and what the list calls them). */
export const HOOK_TYPES = [
  { id: 'fetch', label: 'fetch / XHR' },
  { id: 'document', label: 'HTML' },
  { id: 'script', label: 'JS' },
  { id: 'style', label: 'CSS' },
  { id: 'other', label: 'прочее' },
] as const satisfies ReadonlyArray<{ id: string; label: string }>
export type HookResType = (typeof HOOK_TYPES)[number]['id']
export interface HookSearch {
  on: boolean
  query: string
  /** The query is a regular expression (/…/flags or just its body). */
  regex: boolean
  /** Case matters. */
  caseSensitive?: boolean
  types: HookResType[]
  /** Answers bigger than this are skipped (MB). */
  maxMb: number
  /** Only the answers whose address has this (empty — any). */
  urlHas?: string
}
export interface BrowserHook {
  id: string
  name: string
  /** app.example.com, *.example.com, or an address prefix https://site/path */
  site: string
  on: boolean
  css: string
  js: string
  search: HookSearch
}
export interface HookHit {
  id: string
  hookId: string
  at: number
  url: string
  method: string
  type: HookResType
  status?: number
  line: number
  col: number
  /** The text around the match (the match at [at, at + len)). */
  snippet: string
  mAt: number
  mLen: number
}
export interface HookStatus {
  /** Searching is paused (Стоп) — nothing is taken until it goes on. */
  paused: boolean
  current?: { hookId: string; url: string; type: HookResType; size: number; done: number }
  queued: number
  scanned: number
  skipped: number
  hits: number
  /** Why the last one was skipped / failed. */
  note?: string
}

export const newHook = (id: string, site: string): BrowserHook => ({
  id,
  name: site ? `Хук ${site}` : 'Новый хук',
  site,
  on: true,
  css: '',
  js: '',
  search: { on: false, query: '', regex: false, types: ['fetch', 'document'], maxMb: 20 },
})

/** Whether an address belongs to a hook's site. */
export function siteMatch(pattern: string, url: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (!/^https?:$/.test(u.protocol)) return false
  if (/^https?:\/\//i.test(p)) return url.toLowerCase().startsWith(p.toLowerCase())
  const host = u.hostname.toLowerCase()
  const want = p.toLowerCase().replace(/\/.*$/, '').replace(/:\d+$/, '')
  if (want.startsWith('*.')) return host === want.slice(2) || host.endsWith(want.slice(1))
  return host === want
}

/** The protocol's resource type → the hook's. */
export function resType(cdpType: string | undefined, mime = ''): HookResType {
  const t = (cdpType ?? '').toLowerCase()
  if (t === 'xhr' || t === 'fetch' || t === 'eventsource') return 'fetch'
  if (t === 'document') return 'document'
  if (t === 'script' || /javascript|ecmascript/.test(mime)) return 'script'
  if (t === 'stylesheet' || mime === 'text/css') return 'style'
  return 'other'
}
/** Text-like answers only (pictures, fonts, video are never looked into): every known kind, or a text's type. */
export const isTextual = (mime: string, type: HookResType) => type !== 'other' || /^text\/|json|xml|javascript|ecmascript|x-www-form|graphql|csv|yaml/i.test(mime)

/** The query as a RegExp (global), or what is wrong with it. */
export function queryRegex(s: HookSearch): RegExp | string {
  const q = s.query
  if (!q) return 'Пустой запрос'
  try {
    if (!s.regex) return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), s.caseSensitive ? 'g' : 'gi')
    const m = /^\/(.+)\/([a-z]*)$/s.exec(q)
    const flags = new Set((m ? m[2] : '').split('').filter((f) => 'imsuy'.includes(f)))
    if (!s.caseSensitive && !m) flags.add('i')
    return new RegExp(m ? m[1] : q, [...flags, 'g'].join(''))
  } catch (e) {
    return `Неверное регулярное выражение: ${e instanceof Error ? e.message : String(e)}`
  }
}
