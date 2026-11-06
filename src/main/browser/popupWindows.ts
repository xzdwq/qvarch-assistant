import { Menu, type BrowserWindow, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { newWindowPlace } from '../../shared/browser/popupRule'
import { makeIcon } from '../icon'
import { tellIdentity, type ChromeOverride } from './pageIdentity'

/** What a browser page's new windows reach: the window they stand over, the tabs, how pages are told they are Chrome. */
export interface PopupHost {
  /** The app window a popup stands over (none — it stands on its own). */
  owner(): BrowserWindow | undefined
  /** A new window that is not a popup (a link's new tab): a tab of the page's browser. */
  toTab(url: string): void
  chrome(): ChromeOverride
  /** The browser pages' preload: a popup's sign-in form gets the saved login, a login sent is offered to keep. */
  preload: string
}

/** A popup's size when the page names none. */
const POPUP_SIZE = { width: 520, height: 680 }

/** The popups browser pages opened (alive): pages of the browser too (the saved passwords answer them). */
const popups = new WeakSet<WebContents>()
export const isBrowserPopup = (wc: WebContents): boolean => popups.has(wc)

/**
 * A browser page's new windows: a popup (window.open with features — a sign-in) is a real window of the same profile
 * that keeps its opener (it reports back to the page and closes itself), a link's new tab — `toTab`. The popup's own
 * new windows go the same way; it closes with its opener.
 */
export function wirePopups(wc: WebContents, host: PopupHost): void {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const place = newWindowPlace(disposition, url)
    switch (place) {
      case 'window':
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            ...POPUP_SIZE,
            parent: host.owner(),
            icon: makeIcon(64),
            autoHideMenuBar: true,
            show: true,
            // (the opener's profile comes with it — Chromium keeps a popup in its opener's)
            webPreferences: { preload: host.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
          },
        }
      case 'tab':
        host.toTab(url)
        return { action: 'deny' }
      case 'none':
        return { action: 'deny' }
      default: {
        const never: never = place
        return never
      }
    }
  })
  wc.on('did-create-window', (win) => wirePopupWindow(wc, win, host))
}

/** A popup opened: the browser's rules on it (no menu bar, web only, told it is Chrome), an editing menu, gone with its opener. */
function wirePopupWindow(opener: WebContents, win: BrowserWindow, host: PopupHost): void {
  const wc = win.webContents
  popups.add(wc)
  win.setMenu(null)
  wirePopups(wc, host)
  wc.on('will-navigate', (e, url) => {
    if (!/^(https?:|about:)/i.test(url)) e.preventDefault()
  })
  wc.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && void chromeLike(wc, host, d.url))
  void chromeLike(wc, host)
  wc.on('context-menu', (_e, p) => Menu.buildFromTemplate(popupMenu(wc, p)).popup({ window: win }))
  const closeWithOpener = () => !win.isDestroyed() && win.close()
  opener.once('destroyed', closeWithOpener)
  win.once('closed', () => !opener.isDestroyed() && opener.off('destroyed', closeWithOpener))
}

/** The popup's page told what browser it is, as the tabs' pages are (Chrome; a sign-in host — Firefox). */
async function chromeLike(wc: WebContents, host: PopupHost, url = wc.getURL()): Promise<void> {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    await tellIdentity(wc, wc.debugger, url, () => host.chrome())
  } catch {
    // (its DevTools hold it, the page going — the session's headers still say Chrome)
  }
}

/** A popup's context menu: editing (a sign-in form's fields), the page's code. */
function popupMenu(wc: WebContents, p: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = []
  if (p.isEditable) items.push({ label: 'Вырезать', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Копировать', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Вставить', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' })
  else if (p.selectionText) items.push({ label: 'Копировать', role: 'copy' }, { type: 'separator' })
  items.push({ label: 'Обновить', click: () => wc.reload() }, { label: 'Посмотреть код', click: () => wc.inspectElement(p.x, p.y) })
  return items
}
