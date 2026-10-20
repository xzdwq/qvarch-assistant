/**
 * Runnable notes: blocks that run and share one context per note.
 *
 *   ```http name=login              a request (the .http file format of JetBrains / VS Code REST Client):
 *   POST {{base}}/auth/login          METHOD URL, headers, a blank line, the body; {{ path }} — a value of
 *   Content-Type: application/json    the context (or the HTTP section's variable). Its answer is published
 *                                     as `login`: { status, ok, headers, body, time, size, url }.
 *   {"user": "{{user}}"}
 *   ```
 *   ```ts run name=total             code (JS, or TS — its types are cut away), run apart from the app: the
 *   return items.reduce(...)          context's values are its variables; what it returns is published under
 *   ```                               its name; `set('x', v)` publishes more; console.* is shown.
 *   ```json name=items               data: published as soon as it parses.
 *   ```json ref=login.body           a value of the context, shown live.
 *   ```ts playwright name=shot        a browser scenario (Playwright, the installed Edge / Chrome): page,
 *   await page.goto(url)              context, expect, step(); a trace and Allure results are kept; flags:
 *   ```                               headed (the window shown), notrace, browser=chrome.
 *
 * In the text, `{{ login.status }}` shows the value.
 */
export type RunKind = 'http' | 'code' | 'data' | 'ref' | 'pw'
/** The browsers a Playwright block can drive (installed ones; Chromium — if it was downloaded). */
export const PW_BROWSERS = ['msedge', 'chrome', 'chromium'] as const
export type PwBrowser = (typeof PW_BROWSERS)[number]
export interface BlockInfo {
  lang: string
  name?: string
  ref?: string
  run: boolean
  /** Shared functions: put before every code block of the note (not run alone). */
  lib: boolean
  /** Seconds a code block may run (default 30; a Playwright one — 120). */
  timeout?: number
  /** A Playwright scenario (```ts playwright). */
  pw?: boolean
  /** Playwright: the browser's window shown. */
  headed?: boolean
  /** Playwright: no trace kept. */
  notrace?: boolean
  /** Playwright: which browser (default msedge). */
  browser?: PwBrowser
  /** Its error does not stop «Выполнить всё» (a check expected to fail, a flaky one). */
  soft?: boolean
  /** Playwright: the Браузер section's sign-ins (its cookies) — a site entered there (SSO too) is entered here. */
  session?: boolean
}
/** ```lang key=value flag … */
export function parseInfo(info: string): BlockInfo {
  const parts = info.trim().split(/\s+/).filter(Boolean)
  const out: BlockInfo = { lang: (parts.shift() ?? '').toLowerCase(), run: false, lib: false }
  for (const p of parts) {
    const m = /^([\w-]+)=(.*)$/.exec(p)
    if (!m) {
      if (p === 'run') out.run = true
      else if (p === 'lib') out.lib = true
      else if (p === 'playwright' || p === 'pw') out.pw = true
      else if (p === 'headed') out.headed = true
      else if (p === 'notrace') out.notrace = true
      else if (p === 'soft') out.soft = true
      else if (p === 'session') out.session = true
      continue
    }
    if (m[1] === 'name' && isName(m[2])) out.name = m[2]
    else if (m[1] === 'ref') out.ref = m[2]
    else if (m[1] === 'timeout' && Number(m[2]) > 0) out.timeout = Math.min(3600, Number(m[2]))
    else if (m[1] === 'browser' && (PW_BROWSERS as readonly string[]).includes(m[2])) out.browser = m[2] as PwBrowser
  }
  return out
}
export const isName = (s: string) => /^[A-Za-z_$][\w$]*$/.test(s) && !RESERVED.has(s)
const RESERVED = new Set(['ctx', 'runs', 'set', 'console', 'page', 'context', 'browser', 'expect', 'step', 'devices', 'await', 'return', 'function', 'class', 'const', 'let', 'var', 'new', 'this', 'import', 'export', 'default', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'yield', 'null', 'true', 'false', 'undefined'])
export function infoMd(i: BlockInfo): string {
  return [
    i.lang,
    i.pw ? 'playwright' : '',
    i.run && !i.pw ? 'run' : '',
    i.lib ? 'lib' : '',
    i.name ? `name=${i.name}` : '',
    i.ref ? `ref=${i.ref}` : '',
    i.pw && i.browser && i.browser !== 'msedge' ? `browser=${i.browser}` : '',
    i.pw && i.headed ? 'headed' : '',
    i.pw && i.notrace ? 'notrace' : '',
    i.pw && i.session ? 'session' : '',
    i.soft ? 'soft' : '',
    i.timeout ? `timeout=${i.timeout}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
/** What a fenced block of this info is (undefined — plain code, not run). */
export function runKindOf(i: BlockInfo): RunKind | undefined {
  if (i.lang === 'http' || i.lang === 'rest') return 'http'
  const code = ['js', 'javascript', 'ts', 'typescript'].includes(i.lang)
  if (code && i.pw && !i.lib) return 'pw'
  if (code && (i.run || i.lib)) return 'code'
  if ((i.lang === 'json' || i.lang === 'yaml') && i.ref) return 'ref'
  if ((i.lang === 'json' || i.lang === 'yaml') && i.name) return 'data'
  return undefined
}

// ---------- the context's values ----------
/** A path into the context: login.body.items[0].id, items.length, h["content-type"]. */
export function resolvePath(ctx: Record<string, unknown>, path: string): { ok: boolean; value?: unknown } {
  const p = path.trim()
  const m = /^([A-Za-z_$][\w$]*)/.exec(p)
  if (!m || !(m[1] in ctx)) return { ok: false }
  let v: unknown = ctx[m[1]]
  let rest = p.slice(m[1].length)
  while (rest) {
    let step: RegExpExecArray | null
    if ((step = /^\.([A-Za-z_$][\w$]*)/.exec(rest))) {
      const k = step[1]
      v = k === 'length' && (Array.isArray(v) || typeof v === 'string') ? v.length : v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
    } else if ((step = /^\[\s*(\d+)\s*\]/.exec(rest))) v = Array.isArray(v) ? v[Number(step[1])] : v && typeof v === 'object' ? (v as Record<string, unknown>)[step[1]] : undefined
    else if ((step = /^\[\s*(["'])(.*?)\1\s*\]/.exec(rest))) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[step[2]] : undefined
    else return { ok: false }
    rest = rest.slice(step[0].length)
  }
  return { ok: true, value: v }
}
export const TEMPLATE = /\{\{\s*([^{}]+?)\s*\}\}/g
/** {{ path }} replaced by the context's values (objects as JSON); unknown ones stay as they are. */
export function interpolate(text: string, ctx: Record<string, unknown>): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(TEMPLATE, (all, path: string) => {
    const r = resolvePath(ctx, path)
    if (!r.ok) {
      missing.push(path)
      return all
    }
    return r.value === undefined || r.value === null ? '' : typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
  })
  return { text: out, missing }
}
/** A value in a few words: «массив · 120», «объект · 8 ключей», a short text. */
export function summary(v: unknown): string {
  if (v === undefined) return 'нет значения'
  if (v === null) return 'null'
  if (Array.isArray(v)) return `массив · ${v.length}`
  if (typeof v === 'object') return `объект · ${Object.keys(v as object).length} ${plural(Object.keys(v as object).length, 'ключ', 'ключа', 'ключей')}`
  const s = String(v)
  return s.length > 60 ? `${s.slice(0, 60)}…` : s
}
const plural = (n: number, one: string, few: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many)

// ---------- a request block ----------
export interface HttpText {
  method: string
  url: string
  headers: Array<[string, string]>
  body: string
}
const METHODS = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|QUERY)\s+/i
/** The .http text → a request (comments # and // on top are skipped; no method — GET). */
export function parseHttpText(text: string): HttpText {
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  while (i < lines.length && (!lines[i].trim() || /^\s*(#|\/\/)/.test(lines[i]))) i++
  const first = (lines[i++] ?? '').trim()
  const m = METHODS.exec(first)
  const method = m ? m[1].toUpperCase() : 'GET'
  const url = (m ? first.slice(m[0].length) : first).replace(/\s+HTTP\/[\d.]+$/i, '').trim()
  const headers: Array<[string, string]> = []
  for (; i < lines.length && lines[i].trim(); i++) {
    if (/^\s*(#|\/\/)/.test(lines[i])) continue
    const h = /^\s*([^:\s]+)\s*:\s*(.*)$/.exec(lines[i])
    if (h) headers.push([h[1], h[2]])
  }
  const body = lines.slice(i + 1).join('\n').replace(/\s+$/, '')
  return { method, url, headers, body }
}
export function httpTextOf(r: HttpText): string {
  return [`${r.method} ${r.url}`, ...r.headers.map(([k, v]) => `${k}: ${v}`), ...(r.body ? ['', r.body] : [])].join('\n')
}
/** The answer as the context keeps it: the body parsed when it is JSON. */
export function publishedAnswer(r: { status: number; statusText: string; headers: Array<[string, string]>; body: string; time: number; size: number; url: string }): Record<string, unknown> {
  let body: unknown = r.body
  try {
    if (/^\s*[[{]/.test(r.body)) body = JSON.parse(r.body)
  } catch {
    // text
  }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: r.statusText, headers: Object.fromEntries(r.headers.map(([k, v]) => [k.toLowerCase(), v])), body, time: r.time, size: r.size, url: r.url }
}
