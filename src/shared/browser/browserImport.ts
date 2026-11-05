import { browserId, type Bookmark } from './tabs'

/**
 * Moving in from another browser: its bookmarks (a Chromium profile's Bookmarks file) put into a folder of their own,
 * the ones here already left out; its passwords from the CSV it exports (Chromium's columns or Firefox's).
 */

/** A browser whose profiles can be read (Chromium's layout): where its profiles are under %LOCALAPPDATA%. */
export const IMPORT_BROWSERS = [
  { id: 'brave', name: 'Brave', dir: 'BraveSoftware\\Brave-Browser\\User Data' },
  { id: 'chrome', name: 'Google Chrome', dir: 'Google\\Chrome\\User Data' },
  { id: 'edge', name: 'Microsoft Edge', dir: 'Microsoft\\Edge\\User Data' },
  { id: 'vivaldi', name: 'Vivaldi', dir: 'Vivaldi\\User Data' },
  { id: 'yandex', name: 'Яндекс Браузер', dir: 'Yandex\\YandexBrowser\\User Data' },
] as const
/** A profile of such a browser found on this computer. */
export interface ImportSource {
  /** `<browser>|<profile folder>`. */
  id: string
  label: string
  bookmarks: number
}

interface ChromiumNode {
  type?: string
  name?: string
  url?: string
  children?: ChromiumNode[]
}
/** A Chromium node as a bookmark here (a folder with what is inside; anything but a link or a folder — none). */
function nodeOf(n: ChromiumNode): Bookmark | undefined {
  if (n.type === 'url' && typeof n.url === 'string' && /^(https?|file|ftp):/i.test(n.url)) return { id: browserId(), title: String(n.name || n.url).slice(0, 300), url: n.url }
  if (n.type !== 'folder') return undefined
  return { id: browserId(), title: String(n.name || 'Папка').slice(0, 300), children: (n.children ?? []).map(nodeOf).filter((x): x is Bookmark => !!x) }
}
/** The links in a list of bookmarks, at any depth. */
export const countLinks = (list: readonly Bookmark[]): number => list.reduce((s, b) => s + (b.url ? 1 : countLinks(b.children ?? [])), 0)

/**
 * A Chromium Bookmarks file as one folder named after the browser: the bar's bookmarks at its top, the other roots
 * («Другие закладки», the phone's) as folders in it — empty ones left out.
 */
export function chromiumBookmarks(json: string, browser: string): Bookmark | undefined {
  const d = JSON.parse(json) as { roots?: Record<string, ChromiumNode> }
  const roots = d.roots ?? {}
  const bar = nodeOf({ ...(roots.bookmark_bar ?? {}), type: 'folder' })?.children ?? []
  const rest = Object.entries(roots)
    .filter(([k, n]) => k !== 'bookmark_bar' && n && typeof n === 'object' && Array.isArray(n.children))
    .map(([, n]) => nodeOf({ ...n, type: 'folder' }))
    .filter((x): x is Bookmark => !!x && countLinks([x]) > 0)
  const children = [...bar, ...rest]
  return countLinks(children) ? { id: browserId(), title: browser, children } : undefined
}

/** Bookmarks taken in: links already here (anywhere) left out, folders emptied so — dropped. */
export function newBookmarksOnly(imported: Bookmark, existing: readonly Bookmark[]): { folder?: Bookmark; added: number; skipped: number } {
  const have = new Set<string>()
  const walk = (l: readonly Bookmark[]) => l.forEach((b) => (b.url ? have.add(b.url) : walk(b.children ?? [])))
  walk(existing)
  let skipped = 0
  const keep = (b: Bookmark): Bookmark | undefined => {
    if (b.url) {
      if (have.has(b.url)) return void skipped++
      have.add(b.url)
      return b
    }
    const children = (b.children ?? []).map(keep).filter((x): x is Bookmark => !!x)
    return children.length ? { ...b, children } : undefined
  }
  const folder = keep(imported)
  return { folder, added: folder ? countLinks([folder]) : 0, skipped }
}

/** A CSV's rows (quotes, "" inside them, line breaks inside them). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x !== '')) rows.push(row)
      ;(row = []), (cell = '')
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

/** A login from an exported file: the site's origin, the name, the password. */
export interface ImportedLogin {
  origin: string
  username: string
  password: string
}
/** The columns a login's parts may be under (Chromium: name,url,username,password,note; Firefox: url,username,password,…). */
const LOGIN_COLUMNS = { url: ['url', 'origin', 'website', 'hostname'], username: ['username', 'login', 'user'], password: ['password'] } as const
/**
 * The logins of an exported passwords CSV, by its header: an http(s) site's only (an app's login — left out), one
 * without a password left out. None of the columns — an error said.
 */
export function passwordsCsv(text: string): { logins: ImportedLogin[]; skipped: number } {
  const [head, ...rows] = parseCsv(text)
  const names = (head ?? []).map((h) => h.trim().toLowerCase())
  const col = (k: keyof typeof LOGIN_COLUMNS) => names.findIndex((h) => (LOGIN_COLUMNS[k] as readonly string[]).includes(h))
  const [u, n, p] = [col('url'), col('username'), col('password')]
  if (u < 0 || p < 0) throw new Error('Это не файл паролей: нужны столбцы url и password (экспорт паролей браузера в CSV)')
  const logins: ImportedLogin[] = []
  let skipped = 0
  for (const r of rows) {
    const origin = originOfUrl(r[u] ?? '')
    const password = r[p] ?? ''
    if (!origin || !password || password.length > 500) {
      skipped++
      continue
    }
    logins.push({ origin, username: (n >= 0 ? (r[n] ?? '') : '').slice(0, 200), password })
  }
  return { logins, skipped }
}
function originOfUrl(url: string): string {
  try {
    const o = new URL(url.trim()).origin
    return /^https?:/.test(o) ? o : ''
  } catch {
    return ''
  }
}
