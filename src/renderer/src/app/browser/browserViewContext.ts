import { inject, provide, type InjectionKey } from 'vue'
import type { BrowserSettings, PasswordInfo } from '@shared/browser'
import { bLayout, onBrowserEvent, placeTab, startBrowser } from '../../lib/browser'
import { useAddressLine } from './useAddressLine'
import { useBookmarkDrag } from './useBookmarkDrag'
import { useBookmarks } from './useBookmarks'
import { useBrowserHistory } from './useBrowserHistory'
import { useBrowserTabs } from './useBrowserTabs'
import { useDeviceMode } from './useDeviceMode'
import { usePageLayout } from './usePageLayout'
import { usePaneDrag } from './usePaneDrag'
import { usePasswords } from './usePasswords'
import { useRecordingPanel } from './useRecordingPanel'
import { useSidePanel } from './useSidePanel'
import { useSiteTools } from './useSiteTools'
import { useSwaggerSearch } from './useSwaggerSearch'

/**
 * Everything the Браузер section's parts share — its tabs and panes, the address lines, where the pages go, the
 * device mode, bookmarks, the side panel (the recording, Swagger), the history, passwords, a page's own tools — made
 * once by the section; the main process's news handled here.
 */
function createBrowserView(active: () => boolean, openHttp: (requestId: string) => void) {
  startBrowser()
  const tabs = useBrowserTabs({ active, focusUrl: (pi) => address.focusUrl(pi) })
  const address = useAddressLine(tabs)
  const paneDrag = usePaneDrag(tabs)
  const side = useSidePanel()
  const layout = usePageLayout({ ...tabs, active, suggestFor: address.suggestFor, tabDrag: paneDrag.tabDrag, recOpen: side.recOpen, recW: side.recW })
  const device = useDeviceMode(tabs)
  const bookmarks = useBookmarks({ ...tabs, active })
  const bookmarkDrag = useBookmarkDrag(bookmarks)
  const site = useSiteTools(tabs)
  const recording = useRecordingPanel({ recOpen: side.recOpen, openHttp })
  const swagger = useSwaggerSearch({ ...tabs, openHttp })
  const history = useBrowserHistory(tabs)
  const passwords = usePasswords(tabs)

  /** A key pressed in a page that is the section's (by its name): what it does there. */
  const PAGE_KEYS: Record<string, (id: string, pi: number) => void> = {
    newTab: (_id, pi) => void tabs.newTab(pi),
    closeTab: (id) => tabs.closeTab(id),
    focusUrl: (_id, pi) => void address.focusUrl(pi),
    bookmark: (id) => bookmarks.toggleStar(id),
    device: (id) => device.toggleDevice(id),
    history: () => history.openHistory(),
  }
  /** The browser's news by its type (the tabs, the recording, bookmarks — lib/browser keeps those). */
  const EVENTS: Record<string, (p: unknown) => void> = {
    // a page opened one (target=_blank): next to it, in its pane
    opened: (p) => {
      const { id, opener } = p as { id: string; opener: string }
      const pi = tabs.paneOf(opener)
      placeTab(pi < 0 ? bLayout.cur : pi, id, opener)
    },
    key: (p) => {
      const { id, key } = p as { id: string; key: string }
      PAGE_KEYS[key]?.(id, Math.max(0, tabs.paneOf(id)))
    },
    open: (p) => {
      const { url, newTab } = p as { url: string; newTab: boolean }
      tabs.openUrl(url, newTab)
    },
    login: (p) => (site.login.value = { ...(p as { reqId: string; tabId: string; host: string; realm: string }), user: '', pass: '' }),
    download: (p) => (site.download.value = p as { name: string; path: string; state: string }),
    recError: (p) => (recording.recError.value = String(p)),
    pwAsk: (p) => (passwords.pwAsk.value = p as { askId: string; origin: string; username: string; update: boolean }),
    passwords: (p) => (passwords.passwords.value = p as PasswordInfo[]),
    history: () => history.histOpen.value && void history.loadHistory(),
    settings: (p) => (history.bSettings.value = p as BrowserSettings),
  }
  onBrowserEvent((type, p) => EVENTS[type]?.(p))
  return { tabs, address, paneDrag, side, layout, device, bookmarks, bookmarkDrag, site, recording, swagger, history, passwords }
}
export type BrowserView = ReturnType<typeof createBrowserView>
const BROWSER_VIEW: InjectionKey<BrowserView> = Symbol('browserView')

/** The Браузер section's shared state, made by the section and given to its parts. */
export function provideBrowserView(active: () => boolean, openHttp: (requestId: string) => void): BrowserView {
  const view = createBrowserView(active, openHttp)
  provide(BROWSER_VIEW, view)
  return view
}
/** The Браузер section's shared state, inside one of its parts. */
export function useBrowserView(): BrowserView {
  const view = inject(BROWSER_VIEW)
  if (!view) throw new Error('useBrowserView: outside the Браузер section')
  return view
}
