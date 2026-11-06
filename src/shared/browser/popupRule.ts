/** Where a page's new window goes: a window of its own (it keeps its opener), a tab, or nowhere. */
export const NEW_WINDOW_PLACES = ['window', 'tab', 'none'] as const
export type NewWindowPlace = (typeof NEW_WINDOW_PLACES)[number]

/** What a popup window may show: the web and the blank page a script fills (window.open() then location). */
const POPUP_URL = /^(https?:|about:blank$)/i
/** What a tab may show (a local file linked from a site included). */
const TAB_URL = /^(https?:|file:)/i

/**
 * A page's window.open / target=_blank, by how it asked (Chromium's disposition): a window with features (a sign-in
 * popup, window.open(url, name, 'width=…')) — a window of its own, its opener kept (the popup reports back to it);
 * anything else (a link's new tab) — a tab. A blank tab has nothing to show — none.
 */
export function newWindowPlace(disposition: string, url: string): NewWindowPlace {
  if (disposition === 'new-window' && POPUP_URL.test(url)) return 'window'
  return TAB_URL.test(url) ? 'tab' : 'none'
}
