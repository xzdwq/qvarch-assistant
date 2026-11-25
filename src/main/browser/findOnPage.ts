import type { WebContents } from 'electron'
import type { BrowserEmit } from '../../shared/browser'

/**
 * Text searched on a tab's page (Ctrl+F), by Chromium's own search: every match marked, one shown; the counts go to
 * the window as `found`. Empty text — the marks taken off.
 */
export function findOnPage(wc: WebContents, text: string, forward: boolean, next: boolean): void {
  if (!text) return stopFindOnPage(wc, 'clearSelection')
  // (Electron's `findNext`: true starts a new search — the text changed; false — the next / previous match)
  wc.findInPage(text, { forward, findNext: !next })
}
/** The search ended: the marks off (the match shown stays selected — as a browser leaves it). */
export function stopFindOnPage(wc: WebContents, how: 'keepSelection' | 'clearSelection' = 'keepSelection'): void {
  wc.stopFindInPage(how)
}
/** A tab's search results told to the window (each final count; a new search's own start too). */
export function reportFound(wc: WebContents, id: string, emit: BrowserEmit): void {
  wc.on('found-in-page', (_e, r) => r.finalUpdate && emit('found', { id, active: r.activeMatchOrdinal, total: r.matches }))
}
