/**
 * The pages' zoom as the browser remembers it: one per site (as Chromium zooms — every page of a site at once), and
 * one for the docked DevTools; kept between runs in browser.json (Chromium's own memory of it is not relied on).
 */

/** A page's zoom, %: its bounds, a step of the keys / the wheel, the default. */
export const PAGE_ZOOM = { min: 25, max: 300, step: 10, base: 100 } as const
/** The DevTools' zoom as Chromium's zoom level (0 — 100 %, each 1 — ×1.2): its bounds and a step. */
export const DEVTOOLS_ZOOM = { min: -3, max: 4, step: 0.5 } as const
/** At most this many sites' zooms are kept (the oldest set go first). */
const MAX_SITES = 500

/** What is remembered: each site's zoom other than the default, %; the DevTools' zoom level. */
export interface ZoomMemory {
  sites: Record<string, number>
  devtools: number
}

export const clampPageZoom = (p: number): number => Math.min(PAGE_ZOOM.max, Math.max(PAGE_ZOOM.min, Math.round(p)))
export const clampDevtoolsZoom = (z: number): number => Math.min(DEVTOOLS_ZOOM.max, Math.max(DEVTOOLS_ZOOM.min, Math.round(z / DEVTOOLS_ZOOM.step) * DEVTOOLS_ZOOM.step))

/**
 * The site a page's zoom belongs to: a web page — its host (any port, as Chromium has it); a local file, the source
 * viewer — the scheme itself; no address — '' (nothing kept for it).
 */
export function zoomSite(url: string): string {
  try {
    const u = new URL(url)
    if (/^https?:$/.test(u.protocol)) return u.hostname.toLowerCase()
    return u.protocol === 'about:' ? '' : u.protocol
  } catch {
    return ''
  }
}

/** A site's zoom remembered (none — the default). */
export function siteZoom(m: ZoomMemory, url: string): number {
  const site = zoomSite(url)
  return (site && m.sites[site]) || PAGE_ZOOM.base
}

/** The sites' zooms with one set (the default — forgotten); the newest last, the oldest dropped past the limit. */
export function withSiteZoom(sites: Record<string, number>, url: string, percent: number): Record<string, number> {
  const site = zoomSite(url)
  if (!site) return sites
  const { [site]: _old, ...rest } = sites
  const p = clampPageZoom(percent)
  if (p !== PAGE_ZOOM.base) rest[site] = p
  const keys = Object.keys(rest)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SITES))) delete rest[k]
  return rest
}

/** The memory as read from the file (anything wrong in it — left out). */
export function cleanZoomMemory(raw: unknown): ZoomMemory {
  const r = (raw ?? {}) as { sites?: unknown; devtools?: unknown }
  const sites: Record<string, number> = {}
  if (r.sites && typeof r.sites === 'object')
    for (const [k, v] of Object.entries(r.sites as Record<string, unknown>)) if (k && typeof v === 'number' && Number.isFinite(v) && clampPageZoom(v) !== PAGE_ZOOM.base) sites[k] = clampPageZoom(v)
  const d = typeof r.devtools === 'number' && Number.isFinite(r.devtools) ? clampDevtoolsZoom(r.devtools) : 0
  return { sites, devtools: d }
}
