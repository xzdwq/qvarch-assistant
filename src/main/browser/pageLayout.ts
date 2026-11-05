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
  /** A tab closed (or its page made anew: shown again by the next layout). */
  forget(id: string): void {
    this.shownIds.delete(id)
  }
  /** The pages put where the renderer said last (a page made anew goes to its place at once). */
  relayout(): void {
    this.layout(this.lastRects)
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
    const put = (v: WebContentsView, b: Box) => v.setBounds(inside(b))
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
   * The shown pages' pictures (and their docked tools'), to stand in their place while something of the app is over
   * them — taken first, the pages hidden only once the pictures are on the screen (no frame with neither).
   */
  async shots(): Promise<Record<string, string>> {
    const shots: Record<string, string> = {}
    for (const id of this.shownIds) {
      const t = this.host.tabs.get(id)
      if (!t || t.asleep) continue
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
    return shots
  }
  /** Something of the app is over the pages (a menu, a dialog): the pages hide — their pictures in their place — and come back after. */
  cover(on: boolean): void {
    if (on === this.covered) return
    this.covered = on
    for (const id of this.shownIds) {
      const t = this.host.tabs.get(id)
      if (!t || t.asleep) continue
      t.view.setVisible(!on)
      if (on) t.dev?.setVisible(false)
    }
    if (!on) this.layout(this.lastRects)
  }
}

/**
 * A box from the window's (fractional) px to the view's whole ones, kept inside it: its start rounded up, its end
 * down — the page never covers a line of the app's own around it (a border showing only while the page hides).
 */
function inside(b: Box): { x: number; y: number; width: number; height: number } {
  const x = Math.ceil(b.x - 0.01)
  const y = Math.ceil(b.y - 0.01)
  return { x, y, width: Math.max(1, Math.floor(b.x + b.w + 0.01) - x), height: Math.max(1, Math.floor(b.y + b.h + 0.01) - y) }
}
