import { session } from 'electron'

/**
 * A Playwright scenario run «as the person» (session): the Браузер section's sign-ins handed to it, and what it
 * renewed handed back — a site that rotates its session on every visit would otherwise be signed out there.
 */
const BROWSER_PARTITION = 'persist:qa-browser'

/** The Браузер section's cookies in Playwright's form (a host-only one goes by its address). */
export async function browserCookies(): Promise<Array<Record<string, unknown>>> {
  const list = await session.fromPartition(BROWSER_PARTITION).cookies.get({})
  const same = { strict: 'Strict', lax: 'Lax', no_restriction: 'None', unspecified: 'Lax' } as const
  return list
    .filter((c) => c.domain && c.name)
    .map((c) => {
      const host = c.domain!.replace(/^\./, '')
      const sameSite = c.sameSite === 'no_restriction' && !c.secure ? 'Lax' : same[c.sameSite ?? 'unspecified']
      const base = { name: c.name, value: c.value, httpOnly: !!c.httpOnly, secure: !!c.secure, sameSite, ...(c.expirationDate ? { expires: Math.floor(c.expirationDate) } : {}) }
      return c.hostOnly ? { ...base, url: `${c.secure ? 'https' : 'http'}://${host}${c.path ?? '/'}` } : { ...base, domain: c.domain!, path: c.path ?? '/' }
    })
}

/**
 * The cookies a run left, back into the Браузер section — only the changed and the new ones (what the person did
 * there meanwhile is not overwritten with the same); how many were set.
 */
export async function cookiesBack(sent: Array<Record<string, unknown>>, got: unknown): Promise<number> {
  if (!Array.isArray(got)) return 0
  const key = (c: { name?: unknown; domain?: unknown; path?: unknown; url?: unknown }) => {
    const host = typeof c.url === 'string' ? new URL(c.url).hostname : String(c.domain ?? '').replace(/^\./, '')
    return `${String(c.name)}|${host}|${typeof c.url === 'string' ? new URL(c.url).pathname : String(c.path ?? '/')}`
  }
  const before = new Map(sent.map((c) => [key(c), String(c.value)]))
  const ses = session.fromPartition(BROWSER_PARTITION)
  const same = { Strict: 'strict', Lax: 'lax', None: 'no_restriction' } as const
  let n = 0
  for (const raw of got as Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }>) {
    if (!raw?.name || !raw.domain || before.get(key(raw)) === raw.value) continue
    const host = raw.domain.replace(/^\./, '')
    try {
      await ses.cookies.set({
        url: `${raw.secure ? 'https' : 'http'}://${host}${raw.path || '/'}`,
        name: raw.name,
        value: raw.value,
        // a leading dot — for the subdomains too; none — this host only
        ...(raw.domain.startsWith('.') ? { domain: raw.domain } : {}),
        path: raw.path || '/',
        secure: raw.secure,
        httpOnly: raw.httpOnly,
        sameSite: same[raw.sameSite] ?? 'lax',
        ...(raw.expires > 0 ? { expirationDate: raw.expires } : {}),
      })
      n++
    } catch {
      // one refused — the rest still go
    }
  }
  return n
}

/** The sites a scenario opens (its page.goto addresses): their origins. */
export function originsOf(code: string): string[] {
  return [...code.matchAll(/page\.goto\(\s*['"`](https?:\/\/[^'"`]+)/g)]
    .map((m) => {
      try {
        return new URL(m[1]).origin
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}
