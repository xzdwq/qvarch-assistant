import { BODY_MODES, buildUrl, findNode, httpId, METHOD_COLOR, toCurl, type HttpDoc, type HttpFolder, type HttpKV, type HttpMethod, type HttpNode, type HttpRequest, type HttpSettings } from './http'

// ---------- the tree ----------

/**
 * Requests brought in (a recorded chain, the API map's calls, a Postman file): their folder on top, their variables
 * set — one there already takes the new value (and stays secret, or becomes so), a new one is added.
 */
export function importInto(doc: Pick<HttpDoc, 'items' | 'vars'>, folder: HttpFolder | undefined, vars: ReadonlyArray<HttpKV & { secret?: boolean }>): void {
  if (folder) doc.items.unshift(folder)
  for (const v of vars) {
    const row = doc.vars.find((x) => x.key === v.key)
    if (row) Object.assign(row, { value: v.value, on: v.on, ...(v.secret ? { secret: true } : {}) })
    else doc.vars.push({ on: v.on, key: v.key, value: v.value, ...(v.secret ? { secret: true } : {}) })
  }
}

/** A row of the requests tree as shown: the node, its depth, the list it lives in. */
export type HttpTreeRow = { node: HttpNode; depth: number; parent: HttpNode[] }

/** The tree as rows: open folders show their children, one level deeper. */
export function treeRows(items: HttpNode[]): HttpTreeRow[] {
  const out: HttpTreeRow[] = []
  const walk = (list: HttpNode[], depth: number) => {
    for (const n of list) {
      out.push({ node: n, depth, parent: list })
      if (n.type === 'folder' && n.open) walk(n.children, depth + 1)
    }
  }
  walk(items, 0)
  return out
}
/** The list a node lives in. */
export function parentListOf(items: HttpNode[], id: string): HttpNode[] | undefined {
  for (const n of items) {
    if (n.id === id) return items
    if (n.type === 'folder') {
      const p = parentListOf(n.children, id)
      if (p) return p
    }
  }
  return undefined
}
/** Where a new thing goes: into the selected folder / the selected one's folder, else the top. */
export function targetListFor(items: HttpNode[], selected?: string): HttpNode[] {
  const n = selected ? findNode(items, selected) : undefined
  if (n?.type === 'folder') return n.children
  return (selected && parentListOf(items, selected)) || items
}
/** Whether a node is somewhere inside a folder. */
export function isInside(id: string, folder: HttpNode): boolean {
  return folder.type === 'folder' && folder.children.some((c) => c.id === id || isInside(id, c))
}
/** A copy with new ids (a folder — with everything in it). */
export function cloneWithNewIds<T extends HttpNode>(n: T): T {
  const c = JSON.parse(JSON.stringify(n)) as T
  const fresh = (x: HttpNode) => {
    x.id = httpId()
    if (x.type === 'folder') x.children.forEach(fresh)
  }
  fresh(c)
  return c
}
/**
 * A node dropped: onto a folder — into it (the folder opens); onto a request — before it; nowhere — to the top level.
 * Not onto itself or into its own folder. Whether it moved.
 */
export function moveNode(items: HttpNode[], id: string, target?: HttpNode): boolean {
  if (id === target?.id) return false
  const n = findNode(items, id)
  if (!n || (target && isInside(target.id, n))) return false
  const from = parentListOf(items, id)
  if (!from) return false
  from.splice(from.indexOf(n), 1)
  if (!target) items.push(n)
  else if (target.type === 'folder') {
    target.children.push(n)
    target.open = true
  } else {
    const to = parentListOf(items, target.id) ?? items
    to.splice(to.indexOf(target), 0, n)
  }
  return true
}

// ---------- the request ----------

export type RequestTab = 'params' | 'headers' | 'auth' | 'body' | 'pre' | 'post'
/** The request's tabs: their names and what the small counter beside a name counts. */
export const REQUEST_TABS: Array<{ id: RequestTab; label: string; count: (r: HttpRequest) => number }> = [
  { id: 'params', label: 'Параметры', count: (r) => r.params.filter((x) => x.on && x.key).length },
  { id: 'headers', label: 'Заголовки', count: (r) => r.headers.filter((x) => x.on && x.key).length },
  { id: 'auth', label: 'Авторизация', count: (r) => (r.auth.type === 'none' ? 0 : 1) },
  { id: 'body', label: 'Тело', count: (r) => (r.body.mode === 'none' ? 0 : 1) },
  { id: 'pre', label: 'Перед запросом', count: (r) => r.pre.requests.length + (r.pre.script.trim() ? 1 : 0) },
  { id: 'post', label: 'Обработка ответа', count: (r) => (r.post.trim() ? 1 : 0) },
]
/** The counter of a request's tab (0 — not shown). */
export const requestTabCount = (r: HttpRequest, tab: RequestTab): number => REQUEST_TABS.find((t) => t.id === tab)!.count(r)

/** The collection's variables that are on, by name. */
export const varMapOf = (vars: HttpKV[]): Record<string, string> => Object.fromEntries(vars.filter((v) => v.on && v.key).map((v) => [v.key, v.value]))
/** The variables a run set (a token…) put into the collection: changed in place, new ones before the last (empty) row. */
export function takeRunVars(rows: HttpKV[], vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    const row = rows.find((x) => x.key === k)
    if (row) row.value = v
    else rows.splice(Math.max(0, rows.length - 1), 0, { on: true, key: k, value: v })
  }
}
/** Why a JSON body is not JSON ('' — it is, or it is empty); `{{vars}}` count as values. */
export function jsonBodyError(text: string): string {
  if (!text.trim()) return ''
  try {
    JSON.parse(text.replace(/"?\{\{\s*[\w.-]+\s*\}\}"?/g, '"x"'))
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
/** A text pretty-printed when it is JSON (else as it is). */
export function prettyJson(text: string): { text: string; json: boolean } {
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), json: true }
  } catch {
    return { text, json: false }
  }
}

/** The ways to copy a request (the «Копировать» menu). */
export const HTTP_COPY_FORMATS: Array<{ id: string; label: string; get: (r: HttpRequest, vars: Record<string, string>, settings?: HttpSettings) => string }> = [
  { id: 'all', label: 'Весь запрос (для вставки)', get: (r) => JSON.stringify({ qvarchHttp: 1, request: r }, null, 2) },
  { id: 'curl', label: 'cURL', get: (r, vars, settings) => toCurl(r, vars, settings) },
  { id: 'url', label: 'Адрес (с параметрами)', get: (r, vars) => buildUrl(r, vars) },
  { id: 'params', label: 'Параметры', get: (r) => r.params.filter((x) => x.key).map((x) => `${x.on ? '' : '# '}${x.key}=${x.value}`).join('\n') },
  { id: 'headers', label: 'Заголовки', get: (r) => r.headers.filter((x) => x.key).map((x) => `${x.on ? '' : '# '}${x.key}: ${x.value}`).join('\n') },
  { id: 'body', label: 'Тело', get: (r) => (BODY_MODES[r.body.mode].isText ? r.body.text : r.body.rows.filter((x) => x.key).map((x) => `${x.key}=${x.value}`).join('\n')) },
  { id: 'pre', label: 'Скрипт «перед запросом»', get: (r) => r.pre.script },
  { id: 'post', label: 'Скрипт обработки', get: (r) => r.post },
]
/** A request copied with «Весь запрос» read back from the clipboard's text (undefined — not one). */
export function parseCopiedRequest(text: string): HttpRequest | undefined {
  try {
    const v = JSON.parse(text) as { qvarchHttp?: number; request?: HttpRequest }
    return v?.request && v.request.type === 'request' ? v.request : undefined
  } catch {
    return undefined
  }
}

// ---------- labels ----------

/** The long methods' short labels in the tree (the rest as they are). */
const METHOD_SHORT: Partial<Record<HttpMethod, string>> = { DELETE: 'DEL', OPTIONS: 'OPT', QUERY: 'QRY' }
/** The method's label in the tree (short). */
export const methodShort = (m: HttpMethod): string => METHOD_SHORT[m] ?? m
/** The method's colour. */
export const methodColor = (m: HttpMethod): string => METHOD_COLOR[m] ?? 'var(--muted)'
/** A status's class: 2xx, 3xx, 4xx, 5xx. */
export const statusClass = (s: number): string => (s >= 500 ? 'e5' : s >= 400 ? 'e4' : s >= 300 ? 's3' : 's2')
/** A size in bytes in words. */
export const sizeLabel = (n: number): string => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1024 / 1024).toFixed(2)} МБ`)
