import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { PAGE_LOOK_MAX, type PageLook } from '../../shared/browser/pageLook'
import { toPage } from '../ipc/browserPageIpc'
import type { Tab } from './tab'

/**
 * A page of the built-in browser looked at for an AI agent: its tab's preload lists what may be acted on (with the
 * recorder's locators) and answers here. The page given by its address — opened in a new tab and waited for; none —
 * the tab looked at last. The page itself cannot answer for its preload (isolated): only that tab's answer is taken.
 */
const pending = new Map<string, { from: WebContents; ok: (l: PageLook) => void }>()
/** A page's answer to a look (only the asked page's own answer counts). */
export function takeLookReply(from: WebContents, id: unknown, look: unknown): void {
  const p = typeof id === 'string' ? pending.get(id) : undefined
  if (!p || p.from !== from) return
  pending.delete(id as string)
  p.ok(cleanLook(look))
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
/** The answer kept to its shape and size (the names are the page's own text). */
function cleanLook(v: unknown): PageLook {
  const l = (v ?? {}) as Partial<PageLook>
  const items = (Array.isArray(l.items) ? l.items : []).slice(0, PAGE_LOOK_MAX).map((i) => ({ role: str(i?.role, 30), name: str(i?.name, 80), loc: str(i?.loc, 300), ...(i?.disabled ? { disabled: true } : {}) }))
  return { url: str(l.url, 500), title: str(l.title, 200), headings: (Array.isArray(l.headings) ? l.headings : []).slice(0, 20).map((h) => str(h, 80)), ...(typeof l.dialog === 'string' ? { dialog: str(l.dialog, 80) } : {}), items, more: typeof l.more === 'number' ? l.more : 0 }
}

/** A load quiet this long — the page settled (a redirect starts the next load sooner). */
const SETTLE_MS = 2000
/**
 * After the loads settled, a moment for the page's scripts to draw it: no event says «a single-page app has drawn
 * its content» (its data comes by XHR after the load) — the moment is the cheap stand-in for that.
 */
const DRAW_MS = 800
/**
 * A tab's page settled: loaded, and no new load for a moment — a sign-in goes through pages of its own (a login
 * page that passes by itself, its redirects); the one they end at is the page. Given up after `ms`; then DRAW_MS for
 * its scripts to draw it.
 */
function settled(wc: WebContents, ms = 30_000): Promise<void> {
  return new Promise((done) => {
    let quiet: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(limit)
      clearTimeout(quiet)
      wc.off('did-start-loading', busy)
      wc.off('did-stop-loading', calm)
      setTimeout(done, DRAW_MS)
    }
    const busy = () => clearTimeout(quiet)
    const calm = () => {
      clearTimeout(quiet)
      quiet = setTimeout(finish, SETTLE_MS)
    }
    const limit = setTimeout(finish, ms)
    wc.on('did-start-loading', busy)
    wc.on('did-stop-loading', calm)
    if (!wc.isLoading()) calm()
  })
}
export async function lookAtTab(tab: Tab, waitLoad: boolean): Promise<PageLook> {
  const wc = tab.view.webContents
  if (waitLoad) await settled(wc)
  return new Promise<PageLook>((ok, fail) => {
    const id = randomUUID()
    const timer = setTimeout(() => (pending.delete(id), fail(new Error('Страница не ответила — она ещё грузится или занята'))), 8000)
    pending.set(id, { from: wc, ok: (l) => (clearTimeout(timer), ok(l)) })
    toPage(wc, 'look', id)
  })
}
