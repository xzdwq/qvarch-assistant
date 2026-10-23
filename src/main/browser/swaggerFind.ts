import type { WebContents } from 'electron'

/** A fetch with the site's cookies (as the page). */
type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>
export type SwaggerFound = { url: string; text: string } | { error: string; tried: string[] }

/** A text that is an OpenAPI / Swagger description (JSON or YAML). */
const looksLikeSpec = (s: string) => /"(openapi|swagger)"\s*:\s*"/.test(s.slice(0, 4000)) || /^\s*(openapi|swagger)\s*:/m.test(s.slice(0, 4000))
/** The usual places of a description on a server (Spring, NestJS, FastAPI, ASP.NET, Go…), from the root. */
const ROOT_PLACES = ['/v3/api-docs', '/v2/api-docs', '/openapi.json', '/swagger.json', '/swagger/v1/swagger.json', '/api-json', '/api-docs', '/api-docs.json', '/api/swagger.json', '/api/openapi.json', '/api/v1/swagger.json', '/api/v1/openapi.json', '/api/v3/api-docs', '/swagger/doc.json', '/docs/openapi.json', '/openapi.yaml', '/swagger.yaml', '/api/swagger/v1/swagger.json']
/** The places near a page's own path (a Swagger UI under /docs names its description beside it). */
const nearPlaces = (path: string) => (path && path !== '/' ? [`${path}-json`, `${path}/swagger.json`, `${path}/openapi.json`, `${path}/v3/api-docs`, `${path.replace(/\/[^/]*$/, '')}/swagger.json`] : [])

/**
 * Run in the page and each of its frames: Swagger UI knows its spec — the definition picked in «Select a definition» —
 * or already holds it; Redoc names it; else the scripts (a swagger-initializer.js names it).
 */
const LOOK = `(() => {
  try {
    const ui = window.ui
    if (ui) {
      const sel = ui.specSelectors || {}
      const spec = sel.specJson && sel.specJson()
      const js = spec && spec.toJS ? spec.toJS() : null
      const c = ui.getConfigs ? ui.getConfigs() : {}
      const cur = (sel.url && sel.url()) || c.url || null
      const named = c.urls && (c.urls.find((u) => u.name === c['urls.primaryName']) || c.urls[0])
      return { spec: js && (js.openapi || js.swagger) ? JSON.stringify(js) : null, url: cur || (named && named.url) || null, here: location.href }
    }
  } catch (e) {}
  const r = document.querySelector('redoc[spec-url]')
  return { spec: null, url: r ? r.getAttribute('spec-url') : null, here: location.href, scripts: [...document.scripts].map((s) => s.src).filter(Boolean) }
})()`
type Found = { spec: string | null; url: string | null; here: string; scripts?: string[] }

/**
 * The site's Swagger / OpenAPI description: what the page itself shows (Swagger UI, Redoc), else the usual
 * places on its server. Fetched with the site's cookies (as the page).
 */
export async function findSwagger(wc: WebContents, fetch: Fetch): Promise<SwaggerFound> {
  const page = wc.getURL()
  let origin: string
  try {
    origin = new URL(page).origin
  } catch {
    return { error: 'Откройте сайт во вкладке', tried: [] }
  }
  if (!/^https?:/.test(origin)) return { error: 'Откройте сайт во вкладке', tried: [] }
  const tried: string[] = []
  const get = async (url: string): Promise<string | undefined> => {
    tried.push(url)
    try {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 7000)
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json, application/yaml, text/yaml, */*' } })
      clearTimeout(timer)
      if (!r.ok) return undefined
      const text = await r.text()
      return text.length > 30 * 1024 * 1024 ? undefined : text
    } catch {
      return undefined
    }
  }
  /** A place's text when it is a description. */
  const spec = async (u: string) => {
    const text = await get(u)
    return text && looksLikeSpec(text) ? { url: u, text } : undefined
  }
  // 1. the page and every frame in it (Swagger UI is often inside an iframe)
  const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)]
  const scripts: Array<{ src: string; base: string }> = []
  for (const frame of frames) {
    let found: Found | undefined
    try {
      found = (await frame.executeJavaScript(LOOK, true)) as Found
    } catch {
      continue
    }
    if (!found) continue
    if (found.spec) return { url: found.url ? new URL(found.url, found.here).href : found.here, text: found.spec }
    if (found.url) {
      const hit = await spec(new URL(found.url, found.here).href)
      if (hit) return hit
    }
    for (const s of found.scripts ?? []) if (/swagger|initializer/i.test(s)) scripts.push({ src: s, base: found.here })
  }
  // a swagger-initializer.js names it
  for (const s of scripts.slice(0, 4)) {
    const js = await get(s.src)
    const m = js?.match(/url\s*:\s*["'`]([^"'`]+)["'`]/)
    if (m) {
      const hit = await spec(new URL(m[1], s.base).href)
      if (hit) return hit
    }
  }
  // 2. the usual places: near the page, then from the root
  const path = new URL(page).pathname.replace(/\/+$/, '')
  for (const p of [...new Set([...nearPlaces(path), ...ROOT_PLACES])]) {
    const hit = await spec(origin + p)
    if (hit) return hit
  }
  // Springfox: the list of its groups
  const res = await get(`${origin}/swagger-resources`)
  if (res) {
    try {
      const first = (JSON.parse(res) as Array<{ url?: string; location?: string }>)[0]
      const hit = await spec(new URL(first?.url ?? first?.location ?? '', origin).href)
      if (hit) return hit
    } catch {
      // not that
    }
  }
  return { error: 'Swagger / OpenAPI не найден', tried }
}
