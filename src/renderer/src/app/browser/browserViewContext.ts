import { inject, provide, type InjectionKey } from 'vue'
import { dispatchBrowserEvent, type BrowserEventTable, type PageKeyCommand } from '@shared/browser'
import { bLayout, onBrowserEvent, placeTab, startBrowser } from '../../lib/browser'
import { toggleDockByKey } from '../../lib/termDock'
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

/** The browser's news the section itself handles (each one has its handler below — the compiler checks). */
type SectionEvent = 'opened' | 'pageFocus' | 'key' | 'open' | 'login' | 'download' | 'recError' | 'deviceError' | 'pwAsk' | 'passwords' | 'history' | 'settings'

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
  const PAGE_KEYS: Record<PageKeyCommand, (id: string, pi: number) => void> = {
    newTab: (_id, pi) => void tabs.newTab(pi),
    closeTab: (id) => tabs.closeTab(id),
    reopenTab: () => void tabs.reopenTab(),
    terminal: () => toggleDockByKey(),
    focusUrl: (_id, pi) => void address.focusUrl(pi),
    bookmark: (id) => bookmarks.toggleStar(id),
    device: (id) => device.toggleDevice(id),
    history: () => history.openHistory(),
  }
  /** The browser's news the section handles, by name (the tabs, the recording, bookmarks — lib/browser keeps those). */
  const EVENTS: BrowserEventTable<SectionEvent> = {
    // a page opened one (target=_blank): next to it, in its pane
    opened: ({ id, opener }) => {
      const pi = tabs.paneOf(opener)
      placeTab(pi < 0 ? bLayout.cur : pi, id, opener)
    },
    // a page took the focus (a click on it): the address line let go — its selection with it
    pageFocus: () => address.leaveLine(),
    key: ({ id, key }) => PAGE_KEYS[key]?.(id, Math.max(0, tabs.paneOf(id))),
    open: ({ url, newTab }) => tabs.openUrl(url, newTab),
    login: (p) => (site.login.value = { ...p, user: '', pass: '' }),
    download: (p) => (site.download.value = p),
    recError: (p) => (recording.recError.value = p),
    // (a device mode that did not come on: told where the recording's errors are)
    deviceError: (p) => (recording.recError.value = p),
    pwAsk: (p) => (passwords.pwAsk.value = p),
    passwords: (p) => (passwords.passwords.value = p),
    history: () => history.histOpen.value && void history.loadHistory(),
    settings: (p) => (history.bSettings.value = p),
  }
  onBrowserEvent((...e) => dispatchBrowserEvent(EVENTS, ...e))
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
