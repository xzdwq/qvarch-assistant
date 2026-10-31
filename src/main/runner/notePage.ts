import { BrowserWindow, webContents, type WebContents } from 'electron'
import type { NoteRunFrame } from '../../shared/api'
import { NOTE_PARTITION } from '../noteBrowser'

/** Pictures of the page sent to the component this often at most. */
const FRAME_MS = 250
const FRAME_RATE = 6
const DEFAULT_SIZE = { width: 1280, height: 800 }

/**
 * A page of a note's browser for a scenario's run, apart from the screen: a window never shown (drawn offscreen), of
 * the same profile as the note's browsers (their sign-ins), opened where the browser shows now and of its size (or at
 * its block's address). The run goes on whatever the person does — another note, another section, the window down,
 * the cursor anywhere: nothing is typed into the window (a page inside the window takes its keys from where the focus
 * is). Its picture goes to the component as it changes.
 */
export async function openNotePage(o: { note: string; name: string; url?: string; wc?: number; sender: WebContents; onFrame: (f: NoteRunFrame) => void }): Promise<{ wc: WebContents; close(): void }> {
  const g = o.wc === undefined ? undefined : webContents.fromId(o.wc)
  // (only a browser of the very window that asks)
  const shown = g && !g.isDestroyed() && g.getType() === 'webview' && g.hostWebContents === o.sender ? g : undefined
  const at = shown && /^https?:/i.test(shown.getURL()) ? shown.getURL() : o.url
  const size = shown ? await sizeOf(shown) : DEFAULT_SIZE
  const win = new BrowserWindow({ show: false, ...size, webPreferences: { offscreen: true, partition: NOTE_PARTITION, backgroundThrottling: false, sandbox: true, contextIsolation: true } })
  const wc = win.webContents
  // (a page's new windows are never shown: the run stays where it is)
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.setFrameRate(FRAME_RATE)
  let last = 0
  wc.on('paint', (_e, _dirty, image) => {
    const now = Date.now()
    if (now - last < FRAME_MS || image.isEmpty()) return
    last = now
    o.onFrame({ note: o.note, name: o.name, frame: `data:image/jpeg;base64,${image.toJPEG(60).toString('base64')}` })
  })
  // (a page that fails to load is still a page: the scenario sees it and says so)
  await wc.loadURL(at ?? 'about:blank').catch(() => undefined)
  return {
    wc,
    close: () => {
      o.onFrame({ note: o.note, name: o.name, ended: true })
      if (!win.isDestroyed()) win.destroy()
    },
  }
}

/** The page's size as the browser on the screen shows it (a page lays itself out by it). */
async function sizeOf(g: WebContents): Promise<{ width: number; height: number }> {
  const s = (await g.executeJavaScript('[innerWidth, innerHeight]').catch(() => null)) as [number, number] | null
  if (!s || !(s[0] > 0) || !(s[1] > 0)) return DEFAULT_SIZE
  return { width: Math.max(320, Math.round(s[0])), height: Math.max(240, Math.round(s[1])) }
}
