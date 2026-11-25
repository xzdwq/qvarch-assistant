/**
 * Links a page hands to another application (mailto:, tel:, an app's own scheme): what makes a link external, and the
 * sites the person let open such links without asking again (by site and scheme, as Chrome remembers it).
 */

/** The schemes the browser shows itself (its pages, its own service pages): any other is an application's. */
export const BROWSER_SCHEMES = ['http', 'https', 'file', 'about', 'data', 'blob', 'javascript', 'chrome', 'devtools', 'view-source', 'qa-source'] as const

/** A link's scheme when it is an application's (mailto, tel, msteams…); a page's own — none (one letter — a drive: C:\…). */
export function externalScheme(url: string): string | undefined {
  const m = /^([a-z][a-z0-9+.-]+):/i.exec(url.trim())
  if (!m) return undefined
  const scheme = m[1].toLowerCase()
  return (BROWSER_SCHEMES as readonly string[]).includes(scheme) ? undefined : scheme
}

/** The sites allowed to open external links without asking: site (origin) → schemes. */
export type ExternalMemory = Record<string, string[]>

/** Whether this site may open links of this scheme without asking. */
export function externalAllowed(mem: ExternalMemory, site: string, scheme: string): boolean {
  return Object.hasOwn(mem, site) && mem[site].includes(scheme)
}
/** The memory with this site allowed this scheme (the same object when it already is). */
export function withExternalAllowed(mem: ExternalMemory, site: string, scheme: string): ExternalMemory {
  if (externalAllowed(mem, site, scheme)) return mem
  return { ...mem, [site]: [...(Object.hasOwn(mem, site) ? mem[site] : []), scheme] }
}
/** The memory as written (anything broken dropped). */
export function cleanExternalMemory(raw: unknown): ExternalMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ExternalMemory = {}
  for (const [site, list] of Object.entries(raw as Record<string, unknown>)) {
    const schemes = Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && /^[a-z][a-z0-9+.-]*$/.test(s)) : []
    if (schemes.length) out[site] = [...new Set(schemes)]
  }
  return out
}
/** The site a page is on (what a permission is kept for): its origin; none for a page without one. */
export function siteOf(url: string): string | undefined {
  try {
    const o = new URL(url).origin
    return o === 'null' ? undefined : o
  } catch {
    return undefined
  }
}
