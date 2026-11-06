/**
 * The Браузер section's open tabs, kept between runs (and across updates): the addresses of each pane in order and
 * which of them is shown. A blank tab is ''.
 */
export interface BrowserSession {
  panes: Array<{ urls: string[]; active: number }>
}

/** At most this many panes (the section shows one or two). */
const MAX_PANES = 2
/** At most this many tabs in a pane are kept. */
const MAX_TABS = 100
/** An address longer than this is not kept (a data: page, a huge query). */
const MAX_URL = 8000
/** What a kept tab may open again: the web, a local file, the page source viewer; anything else — a blank tab. */
const KEPT_URL = /^(https?:|file:|qa-source:)/i

/** One tab's address as kept: one it may open again, else blank (''). */
function keptUrl(u: unknown): string {
  return typeof u === 'string' && u.length <= MAX_URL && KEPT_URL.test(u) ? u : ''
}

/**
 * A session as read or sent (anything): its panes with at least one tab, the shown one within them; nothing valid
 * in it — none.
 */
export function cleanSession(raw: unknown): BrowserSession | undefined {
  const panes = (raw as { panes?: unknown } | null | undefined)?.panes
  if (!Array.isArray(panes)) return undefined
  const out: BrowserSession['panes'] = []
  for (const p of panes) {
    const urls = (p as { urls?: unknown } | null)?.urls
    if (!Array.isArray(urls) || !urls.length) continue
    const kept = urls.slice(0, MAX_TABS).map(keptUrl)
    const a = Number((p as { active?: unknown }).active)
    out.push({ urls: kept, active: Number.isInteger(a) ? Math.min(Math.max(0, a), kept.length - 1) : 0 })
    if (out.length === MAX_PANES) break
  }
  return out.length ? { panes: out } : undefined
}
