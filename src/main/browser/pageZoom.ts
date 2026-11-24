import { clampPageZoom, zoomSite } from '../../shared/browser/zoom'
import type { BrowserStore } from './browserStore'
import type { BrowserHost, Tab } from './tab'

/**
 * The pages' zoom: one per site (as Chromium zooms — every page of a site at once), remembered between runs by the
 * browser itself and put on each page as it opens — the tab's zoom shown is always the page's own.
 */
export class PageZoom {
  constructor(
    private host: BrowserHost,
    private store: BrowserStore,
  ) {}

  /** The address a tab's page is at (asleep — the one it had). */
  private urlOf(t: Tab): string {
    return t.asleep ? t.t.url : t.view.webContents.getURL() || t.t.url
  }
  /**
   * A page opened in a tab: zoomed as its site is remembered (Chromium may have put another — its own memory, the
   * site before). Told at each new page: a zoom put before the page is there is lost to the page before it.
   */
  follow(t: Tab, url = this.urlOf(t)): void {
    const p = this.store.siteZoom(url)
    t.t.zoom = p
    if (t.asleep) return
    const wc = t.view.webContents
    if (Math.abs(wc.getZoomFactor() * 100 - p) > 0.5) wc.setZoomFactor(p / 100)
  }
  /** A tab's zoom set (the keys, the wheel, the chip): its site's — every tab at that site goes with it. */
  set(t: Tab, percent: number): void {
    const url = this.urlOf(t)
    const p = clampPageZoom(percent)
    this.store.setSiteZoom(url, p)
    const site = zoomSite(url)
    for (const x of this.host.tabs.values()) {
      if (x !== t && (!site || zoomSite(this.urlOf(x)) !== site)) continue
      x.t.zoom = p
      if (!x.asleep) x.view.webContents.setZoomFactor(p / 100)
    }
    this.host.changed()
  }
}
