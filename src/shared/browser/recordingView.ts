import type { RecLink } from './recordingLinks'

/** How the recorded requests are shown: a request's path, its status's colour class, a body pretty, a link's uses. */

/** The path and query of a request's address (the address itself when it is none). */
export const requestPath = (url: string) => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}
/** A status's class: s2 / s3 — fine, e4 / e5 — the client's / the server's error; none — no answer yet. */
export const statusClass = (s?: number) => (!s ? '' : s >= 500 ? 'e5' : s >= 400 ? 'e4' : s >= 300 ? 's3' : 's2')
/** A JSON body indented; any other text as it is. */
export const prettyBody = (s?: string) => {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
const USE_PLACE: Record<RecLink['uses'][number]['where'], (key: string) => string> = {
  path: () => 'путь',
  query: (key) => `параметр ${key}`,
  body: (key) => `тело ${key}`,
  header: (key) => `заголовок ${key}`,
}
/** Where a link's value is used: «№2 путь, №3 заголовок Authorization». */
export const linkUseText = (l: RecLink) => l.uses.map((u) => `№${u.to + 1} ${USE_PLACE[u.where](u.key)}`).join(', ')
