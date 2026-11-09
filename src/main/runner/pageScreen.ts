import type { CDPSession, Page } from 'playwright-core'

/** A screen a page is to see: its size in CSS px, its pixel density. */
export interface ScreenSize {
  width: number
  height: number
  dpr?: number
}

/**
 * The one way a run sets the page's screen. The app's own pages (browser=qvarch, a note's browser) carry their site's
 * zoom — Chromium keeps one per site for the whole profile, so a tab zoomed to 80 % makes every page of that site see
 * 25 % more CSS px: a 360 px window becomes 450. The screen asked is set as the page will see it: the window × the
 * zoom, the density ÷ the zoom — a 360 × 640 screen at density 1 is exactly that, its picture 360 px wide.
 */
export class PageScreen {
  private cdp?: CDPSession
  private overridden = false
  private last: { width: number; height: number } | null
  private readonly own: Page['setViewportSize']

  /** `zoom` — the page's own zoom when the run got it (1 — a browser of its own: Edge, Chrome). */
  constructor(
    private readonly page: Page,
    readonly zoom = 1,
  ) {
    this.last = page.viewportSize()
    this.own = page.setViewportSize.bind(page)
  }

  /** The screen set: `width` × `height` CSS px at density `dpr` (1 when not said). */
  async set(o: ScreenSize): Promise<void> {
    const width = Math.round(o.width)
    const height = Math.round(o.height)
    const dpr = o.dpr ?? 1
    this.last = { width, height }
    if (near(this.zoom, 1) && near(dpr, 1)) {
      // (Playwright's own way: it knows the size it set)
      if (this.overridden) await this.clear()
      return this.own({ width, height })
    }
    const cdp = (this.cdp ??= await this.page.context().newCDPSession(this.page))
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(width * this.zoom), height: Math.round(height * this.zoom), deviceScaleFactor: dpr / this.zoom, mobile: false })
    this.overridden = true
  }
  /** The size set last (in CSS px), or the page's own. */
  size(): { width: number; height: number } | null {
    return this.last
  }
  /** The override taken off (the page's own window again). */
  async clear(): Promise<void> {
    if (!this.overridden) return
    this.overridden = false
    await this.cdp?.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
  }
  /** The scenario's own `page.setViewportSize` / `page.viewportSize` go through it (the zoom made up for there too). */
  takeOver(): void {
    if (near(this.zoom, 1)) return
    this.page.setViewportSize = (s) => this.set(s)
    this.page.viewportSize = () => this.size()
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.001
