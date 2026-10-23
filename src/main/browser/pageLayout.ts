import type { BrowserWindow, WebContentsView } from 'electron'
import type { Box, BrowserHost, Rect, Tab } from './tab'

/**
 * Where the tabs' pages are: each a native view over the main window, put where the renderer says (the rest hidden);
 * made way for while something of the app opens over them (their pictures shown in their place meanwhile).
 */
export class PageLayout {
  private shownIds = new Set<string>()
  private covered = false
  private lastRects: Rect[] = []

  constructor(
    private host: BrowserHost,
    /** The device mode's scale changed: told to the page. */
    private onScale: (t: Tab) => void,
  ) {}

  /** A tab's page is on the screen now. */
  isShown(id: string): boolean {
    return this.shownIds.has(id)
  }
  /** A tab closed. */
  forget(id: string): void {
    this.shownIds.delete(id)
  }
  /** The main window (made again after it was closed for good): every page goes into it. */
  attach(win: BrowserWindow): void {
    for (const t of this.host.tabs.values()) {
      if (t.asleep) continue
      win.contentView.addChildView(t.view)
      t.view.setVisible(false)
      if (t.dev) {
        win.contentView.addChildView(t.dev)
        t.dev.setVisible(false)
      }
    }
    this.shownIds.clear()
  }
  /** Where the visible pages go (the renderer's rectangles); every other page hides. */
  layout(rects: Rect[]): void {
    this.lastRects = rects
    if (this.covered) return
    const want = new Set(rects.map((r) => r.id))
    const put = (v: WebContentsView, b: Box) => v.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) })
    for (const [id, t] of this.host.tabs) {
      const r = rects.find((x) => x.id === id)
      if (r && r.w > 1 && r.h > 1) {
        t.seen = Date.now()
        if (t.asleep) this.host.wake(t)
        put(t.view, r)
        // the device mode: the page drawn smaller to fit the pane
        if (t.t.device && r.scale && r.scale !== t.devScale) {
          t.devScale = r.scale
          this.onScale(t)
        }
        if (!this.shownIds.has(id)) t.view.setVisible(true)
      } else if (this.shownIds.has(id) && !t.asleep) t.view.setVisible(false)
      if (t.dev) {
        if (r?.dev && r.dev.w > 1 && r.dev.h > 1) {
          put(t.dev, r.dev)
          t.dev.setVisible(true)
        } else t.dev.setVisible(false)
      }
    }
    this.shownIds = new Set([...want].filter((id) => this.host.tabs.has(id)))
  }
  /**
   * Something of the app opens over the pages (a menu, a dialog): the pages hide — the renderer shows their
   * pictures in their place meanwhile — and come back after.
   */
  async cover(on: boolean): Promise<Record<string, string>> {
    if (on === this.covered) return {}
    const shots: Record<string, string> = {}
    const tabs = this.host.tabs
    if (on) {
      for (const id of this.shownIds) {
        const t = tabs.get(id)
        if (!t) continue
        try {
          let img = await t.view.webContents.capturePage()
          // the device mode: the picture is the device's whole size, the page drawn smaller in its corner
          if (t.t.device && t.devScale && t.devScale < 1) {
            const sz = img.getSize()
            img = img.crop({ x: 0, y: 0, width: Math.max(1, Math.round(sz.width * t.devScale)), height: Math.max(1, Math.round(sz.height * t.devScale)) })
          }
          shots[id] = img.toJPEG(82).toString('base64')
          if (t.dev?.getVisible()) shots[`${id}:dev`] = (await t.dev.webContents.capturePage()).toJPEG(82).toString('base64')
        } catch {
          // not drawn yet
        }
      }
      this.covered = true
      for (const id of this.shownIds) {
        tabs.get(id)?.view.setVisible(false)
        tabs.get(id)?.dev?.setVisible(false)
      }
    } else {
      this.covered = false
      for (const id of this.shownIds) tabs.get(id)?.view.setVisible(true)
      this.layout(this.lastRects)
    }
    return shots
  }
}
