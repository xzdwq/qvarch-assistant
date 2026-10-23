import { WebContentsView } from 'electron'
import type { BrowserHost, Tab } from './tab'

/**
 * The developer tools, docked under (or beside) the page: a view of their own the page's tools draw into. Hidden,
 * they go on (their console, their network log) and come back as they were; closed with the tab.
 */
export class DockedDevTools {
  constructor(private host: BrowserHost) {}

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
    // the tools draw into our view (the window's own docking does not exist for a view)
    dev.webContents.on('zoom-changed', (_e, dir) => {
      const z = dev.webContents.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)
      dev.webContents.setZoomLevel(Math.min(4, Math.max(-3, z)))
    })
    // Ctrl+Shift+M in the tools: our device mode (theirs has no place in a docked view)
    dev.webContents.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && (i.control || i.meta) && i.shift && i.key.toLowerCase() === 'm') {
        e.preventDefault()
        this.host.emit('key', { id: t.t.id, key: 'device' })
      }
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
