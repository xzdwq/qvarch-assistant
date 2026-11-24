import { WebContentsView } from 'electron'
import { DEVTOOLS_ZOOM } from '../../shared/browser/zoom'
import type { BrowserHost, Tab } from './tab'

/** The tools' zoom keys (with Ctrl): the step each makes (0 — back to 100 %). */
const ZOOM_KEYS: Record<string, number> = { '=': DEVTOOLS_ZOOM.step, '+': DEVTOOLS_ZOOM.step, '-': -DEVTOOLS_ZOOM.step, '0': 0 }

/**
 * The developer tools, docked under (or beside) the page: a view of their own the page's tools draw into. Hidden,
 * they go on (their console, their network log) and come back as they were; closed with the tab.
 */
export class DockedDevTools {
  constructor(
    private host: BrowserHost,
    /** Their zoom level, remembered between runs (one for every tab's tools). */
    private zoom: { level(): number; set(level: number): void },
  ) {}

  /** The tools zoomed by a step (0 — back to 100 %): remembered, and put on every open tools' view. */
  private zoomBy(step: number): void {
    this.zoom.set(step ? this.zoom.level() + step : 0)
    for (const t of this.host.tabs.values()) if (t.dev && !t.dev.webContents.isDestroyed()) t.dev.webContents.setZoomLevel(this.zoom.level())
  }

  open(t: Tab): void {
    // (hidden before — shown again as it was left: its console, its network log)
    if (t.dev) {
      if (!t.t.devtools) {
        t.t.devtools = true
        this.host.changed()
      }
      return
    }
    const dev = new WebContentsView()
    dev.setVisible(false)
    t.dev = dev
    this.host.window()?.contentView.addChildView(dev)
    const wc = t.view.webContents
    // the tools draw into our view (the window's own docking does not exist for a view); their zoom is ours to keep:
    // the wheel and the keys go through it, each load of the tools gets it back
    dev.webContents.on('zoom-changed', (_e, dir) => this.zoomBy(dir === 'in' ? DEVTOOLS_ZOOM.step : -DEVTOOLS_ZOOM.step))
    dev.webContents.on('did-finish-load', () => dev.webContents.setZoomLevel(this.zoom.level()))
    dev.webContents.on('before-input-event', (e, i) => {
      if (i.type !== 'keyDown' || !(i.control || i.meta)) return
      const k = i.key.toLowerCase()
      // Ctrl+Shift+M in the tools: our device mode (theirs has no place in a docked view)
      const act = i.shift && k === 'm' ? () => this.host.emit('key', { id: t.t.id, key: 'device' }) : Object.hasOwn(ZOOM_KEYS, k) && !i.alt ? () => this.zoomBy(ZOOM_KEYS[k]) : undefined
      if (!act) return
      e.preventDefault()
      act()
    })
    wc.setDevToolsWebContents(dev.webContents)
    wc.openDevTools({ mode: 'detach', activate: false })
    wc.once('devtools-closed', () => this.close(t))
    t.t.devtools = true
    this.host.changed()
  }
  close(t: Tab): void {
    const dev = t.dev
    if (!dev) return
    t.dev = undefined
    t.t.devtools = false
    try {
      if (t.view.webContents.isDevToolsOpened()) t.view.webContents.closeDevTools()
    } catch {
      // the page is gone
    }
    try {
      this.host.window()?.contentView.removeChildView(dev)
      dev.webContents.close()
    } catch {
      // gone
    }
    this.host.changed()
  }
  /**
   * The tools' button: shown / hidden — not closed: hidden, the tools go on (their console, their network log, «Preserve
   * log» too), and come back as they were. Closed with the tab.
   */
  toggle(t: Tab): void {
    if (t.dev && t.t.devtools) {
      t.t.devtools = false
      t.dev.setVisible(false)
      this.host.changed()
    } else this.open(t)
  }
}
