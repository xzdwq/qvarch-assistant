import { dialog, shell, type BrowserWindow } from 'electron'
import { externalScheme, siteOf } from '../../shared/browser/externalLinks'
import type { BrowserStore } from './browserStore'

/** What asking about an application's link needs: the window it is asked over, the sites let through. */
export interface ExternalAppsHost {
  window(): BrowserWindow | undefined
  readonly store: BrowserStore
}

/** The link as shown in the question (a long one cut). */
const shown = (url: string) => (url.length > 120 ? `${url.slice(0, 117)}…` : url)

/**
 * Whether a page may hand this link to another application (mailto:, tel:, an app's own scheme): its site let through
 * for this scheme before — yes; else the person is asked, as Chrome asks (a link like this can start any program
 * registered for it); «always» kept for the site and the scheme. Not an application's link — no.
 */
export async function mayOpenExternal(host: ExternalAppsHost, pageUrl: string, url: string): Promise<boolean> {
  const scheme = externalScheme(url)
  if (!scheme) return false
  const site = siteOf(pageUrl)
  if (site && host.store.externalAllowed(site, scheme)) return true
  const ask = {
    type: 'question' as const,
    buttons: ['Открыть', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    title: 'Открыть во внешнем приложении?',
    message: 'Открыть ссылку во внешнем приложении?',
    detail: `${site ?? 'Страница'} хочет открыть ссылку «${shown(url)}» в приложении, которое в Windows открывает ссылки ${scheme}:`,
    ...(site ? { checkboxLabel: `Всегда разрешать ${site} открывать ссылки ${scheme}:` } : {}),
  }
  const win = host.window()
  const r = await (win ? dialog.showMessageBox(win, ask) : dialog.showMessageBox(ask))
  if (r.response !== 0) return false
  if (site && r.checkboxChecked) host.store.allowExternal(site, scheme)
  return true
}

/** A page's application link (window.open('mailto:…')): opened by its application when allowed. */
export async function openExternalFrom(host: ExternalAppsHost, pageUrl: string, url: string): Promise<void> {
  if (await mayOpenExternal(host, pageUrl, url)) await shell.openExternal(url).catch(() => undefined)
}
