/**
 * The browser component of a note:
 *
 *   ```browser name=site            its tabs (one `url:` line each — the one marked `*` is shown),
 *   url: https://jira.example.com   its height; `name=` — the requests can be put into the note's
 *   url: * https://example.com      context ({{ site.requests }}).
 *   height: 560
 *   ```
 */
export interface BrowserBlock {
  tabs: string[]
  active: number
  height: number
}
export const BROWSER_MIN_H = 240
export const BROWSER_DEF_H = 560

export function parseBrowserBody(body: string): BrowserBlock {
  const tabs: string[] = []
  let active = 0
  let height = BROWSER_DEF_H
  for (const l of body.split('\n')) {
    const u = /^\s*url\s*:\s*(\*\s*)?(.+?)\s*$/i.exec(l)
    if (u) {
      if (u[1]) active = tabs.length
      tabs.push(u[2])
      continue
    }
    const h = /^\s*height\s*:\s*(\d+)\s*$/i.exec(l)
    if (h) height = Math.max(BROWSER_MIN_H, Math.min(2000, Number(h[1])))
  }
  if (!tabs.length) tabs.push('about:blank')
  return { tabs, active: Math.min(active, tabs.length - 1), height }
}
export function browserBody(b: BrowserBlock): string {
  return [...b.tabs.map((t, i) => `url: ${i === b.active && b.tabs.length > 1 ? '* ' : ''}${t}`), `height: ${Math.round(b.height)}`].join('\n')
}
/** What a typed address means: an address (https:// added), else a search. */
export function addressOf(text: string): string {
  const t = text.trim()
  if (!t) return 'about:blank'
  if (/^(https?:\/\/|about:)/i.test(t)) return t
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(t)) return `http://${t}`
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return `https://${t}`
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`
}

// ---------- the requests of a tab (the «Запросы» panel) ----------
export interface NetItem {
  id: string
  method: string
  url: string
  /** Document, Script, XHR, Fetch, Image, Stylesheet… */
  type: string
  /** When it started (the protocol's clock, s) and the wall clock (ms). */
  t0: number
  wall: number
  status?: number
  mime?: string
  /** Bytes that came over the network. */
  size?: number
  /** Start to the end (ms); until the answer's first byte. */
  ms?: number
  ttfb?: number
  fromCache?: boolean
  error?: string
  done: boolean
}
export interface NetPage {
  url?: string
  /** DOMContentLoaded / load (the protocol's clock, s). */
  dcl?: number
  load?: number
}
