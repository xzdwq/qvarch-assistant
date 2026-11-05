import { webFrame } from 'electron'

/**
 * A site's page never drags the app's window. Sites made for desktop shells too (Teams, Office: Electron / WebView2)
 * mark their title bars and splash screens `app-region: drag`; a browser's tab ignores it, Electron's view takes it as
 * the window's — the whole page drags the window and stops taking clicks, the next pages too. A user stylesheet's
 * !important outranks the page's own: no region of a page is draggable, from its first frame on.
 */
webFrame.insertCSS('*, *::before, *::after { app-region: no-drag !important; -webkit-app-region: no-drag !important; }', { cssOrigin: 'user' })
