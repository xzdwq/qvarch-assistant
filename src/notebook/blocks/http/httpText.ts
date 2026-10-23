/**
 * The request block's text — the .http format of JetBrains / VS Code REST Client: `METHOD URL`, the query laid out
 * under it, headers, a blank line, the body — and its answer as the note's context keeps it.
 */
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
  let url = (m ? first.slice(m[0].length) : first).replace(/\s+HTTP\/[\d.]+$/i, '').trim()
  // the query laid out under the request line, a parameter a line (indented `?a=1` / `&b=2`)
  for (; i < lines.length && /^\s+[?&]/.test(lines[i]); i++) url += lines[i].trim()
  const headers: Array<[string, string]> = []
  for (; i < lines.length && lines[i].trim(); i++) {
    if (/^\s*(#|\/\/)/.test(lines[i])) continue
    const h = /^\s*([^:\s]+)\s*:\s*(.*)$/.exec(lines[i])
    if (h) headers.push([h[1], h[2]])
  }
  const body = lines.slice(i + 1).join('\n').replace(/\s+$/, '')
  return { method, url, headers, body }
}
/** A request → its .http text. */
export function httpTextOf(r: HttpText): string {
  return [`${r.method} ${r.url}`, ...r.headers.map(([k, v]) => `${k}: ${v}`), ...(r.body ? ['', r.body] : [])].join('\n')
}
/** The answer as the context keeps it: { status, ok, statusText, headers (lower case), body (JSON parsed), time, size, url }. */
export function publishedAnswer(r: { status: number; statusText: string; headers: Array<[string, string]>; body: string; time: number; size: number; url: string }): Record<string, unknown> {
  let body: unknown = r.body
  try {
    if (/^\s*[[{]/.test(r.body)) body = JSON.parse(r.body)
  } catch {
    // text
  }
  return { status: r.status, ok: r.status >= 200 && r.status < 300, statusText: r.statusText, headers: Object.fromEntries(r.headers.map(([k, v]) => [k.toLowerCase(), v])), body, time: r.time, size: r.size, url: r.url }
}
