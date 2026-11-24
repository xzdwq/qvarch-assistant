import { screen, WebContentsView, type BrowserWindow } from 'electron'
import { linkStatusMaxWidth, linkStatusPlace, linkStatusText, type StatusBox } from '../../shared/browser/linkStatus'
import { LINK_STATUS_MARK } from '../../shared/browser/pageMarks'

/** How long the link stays shown after the pointer left it (onto the next link — no blink), ms. */
const HIDE_AFTER_MS = 150

/** The bubble's page: the text in one line (cut with … past the width given); `show` answers the size it took. */
const C = LINK_STATUS_MARK
const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
#b{display:inline-block;box-sizing:border-box;padding:3px 8px;font:12px/16px "Segoe UI",system-ui,sans-serif;color:${C.text};background:${C.bg};border:1px solid ${C.line};border-radius:4px 4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style><div id="b"></div><script>
window.show = (text, max) => { const b = document.getElementById('b'); b.style.maxWidth = max + 'px'; b.textContent = text; const r = b.getBoundingClientRect(); return [Math.ceil(r.width), Math.ceil(r.height)] }
</script>`

/**
 * The link under the pointer shown in the page's bottom corner, as browsers do: a small view of its own over the
 * pages (one for the window) — nothing of it gets into the site's page (its recordings, checks and pictures). Shown
 * only over a tab on the screen; it steps aside from the pointer.
 */
export class LinkStatus {
  private view?: WebContentsView
  private win?: BrowserWindow
  /** The tab whose link is shown and the bubble's size as drawn. */
  private shown?: { tabId: string; width: number; height: number }
  /** Each link told a number: an answer of an older one is not shown. */
  private seq = 0
  private hideTimer?: NodeJS.Timeout

  constructor(
    private deps: {
      window(): BrowserWindow | undefined
      /** Where a tab's page is in the window, while it is on the screen (else none). */
      pageBox(tabId: string): StatusBox | undefined
    },
  ) {}

  /** The page's link under the pointer ('' — none now: hidden a moment later, unless another comes). */
  hover(tabId: string, url: string): void {
    clearTimeout(this.hideTimer)
    if (!url) return void (this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_MS))
    const page = this.deps.pageBox(tabId)
    const view = page && this.ensure()
    if (!page || !view) return this.hide()
    const mine = ++this.seq
    void view.webContents
      .executeJavaScript(`show(${JSON.stringify(linkStatusText(url))}, ${linkStatusMaxWidth(page.width)})`)
      .then((size: [number, number]) => {
        if (mine !== this.seq) return
        const shownBefore = !!this.shown
        this.shown = { tabId, width: size[0], height: size[1] }
        this.place(!shownBefore)
      })
      .catch(() => undefined)
  }
  /** The pages laid out anew (moved, hidden, covered): the bubble follows its page, or hides with it. */
  follow(): void {
    if (this.shown) this.place(false)
  }
  /** The tab's link no more (closed, its page made anew). */
  forget(tabId: string): void {
    if (this.shown?.tabId === tabId) this.hide()
  }
  hide(): void {
    clearTimeout(this.hideTimer)
    this.seq++
    if (!this.shown) return
    this.shown = undefined
    if (this.view && !this.view.webContents.isDestroyed()) this.view.setVisible(false)
  }

  /** The bubble put in its page's corner, away from the pointer (`raise` — over the pages first: shown anew). */
  private place(raise: boolean): void {
    const s = this.shown
    const page = s && this.deps.pageBox(s.tabId)
    const win = this.win
    if (!s || !page || !win || win.isDestroyed() || !this.view) return this.hide()
    const c = screen.getCursorScreenPoint()
    const at = win.getContentBounds()
    const box = linkStatusPlace(page, s, { x: c.x - at.x, y: c.y - at.y })
    // (a page shown after it went over the bubble: the bubble on top again)
    if (raise) win.contentView.addChildView(this.view)
    this.view.setBounds(box)
    this.view.setVisible(true)
  }
  /** The bubble's view, made for the window it goes over (made again with a new window). */
  private ensure(): WebContentsView | undefined {
    const win = this.deps.window()
    if (!win || win.isDestroyed()) return undefined
    if (this.view && this.win === win && !this.view.webContents.isDestroyed()) return this.view
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close()
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    // the pointer came onto the bubble: it steps aside (the page under it keeps the pointer)
    view.webContents.on('before-mouse-event', (_e, m) => m.type === 'mouseMove' && this.follow())
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(() => undefined)
    win.contentView.addChildView(view)
    this.view = view
    this.win = win
    this.shown = undefined
    return view
  }
}
