import { ipcMain, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { PAGE_LOOK_MAX, type PageLook } from '../../shared/browser/pageLook'
import type { Tab } from './tab'

/**
 * A page of the built-in browser looked at for an AI agent: its tab's preload lists what may be acted on (with the
 * recorder's locators) and answers here. The page given by its address — opened in a new tab and waited for; none —
 * the tab looked at last. The page itself cannot answer for its preload (isolated): only that tab's answer is taken.
 */
const pending = new Map<string, { from: WebContents; ok: (l: PageLook) => void }>()
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  ipcMain.on('qa:page-look-reply', (e, id: unknown, look: unknown) => {
    const p = typeof id === 'string' ? pending.get(id) : undefined
    if (!p || p.from !== e.sender) return
    pending.delete(id as string)
    p.ok(cleanLook(look))
  })
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
/** The answer kept to its shape and size (the names are the page's own text). */
function cleanLook(v: unknown): PageLook {
  const l = (v ?? {}) as Partial<PageLook>
  const items = (Array.isArray(l.items) ? l.items : []).slice(0, PAGE_LOOK_MAX).map((i) => ({ role: str(i?.role, 30), name: str(i?.name, 80), loc: str(i?.loc, 300), ...(i?.disabled ? { disabled: true } : {}) }))
  return { url: str(l.url, 500), title: str(l.title, 200), headings: (Array.isArray(l.headings) ? l.headings : []).slice(0, 20).map((h) => str(h, 80)), ...(typeof l.dialog === 'string' ? { dialog: str(l.dialog, 80) } : {}), items, more: typeof l.more === 'number' ? l.more : 0 }
}

/** A tab's page loaded (or given up waiting), then a moment for its scripts to draw it. */
function loaded(wc: WebContents, ms = 20_000): Promise<void> {
  return new Promise((done) => {
    const finish = () => (clearTimeout(timer), setTimeout(done, 800))
    const timer = setTimeout(finish, ms)
    if (!wc.isLoading()) return finish()
    wc.once('did-stop-loading', finish)
  })
}
export async function lookAtTab(tab: Tab, waitLoad: boolean): Promise<PageLook> {
  listen()
  const wc = tab.view.webContents
  if (waitLoad) await loaded(wc)
  return new Promise<PageLook>((ok, fail) => {
    const id = randomUUID()
    const timer = setTimeout(() => (pending.delete(id), fail(new Error('Страница не ответила — она ещё грузится или занята'))), 8000)
    pending.set(id, { from: wc, ok: (l) => (clearTimeout(timer), ok(l)) })
    wc.send('qa:page-look', id)
  })
}
