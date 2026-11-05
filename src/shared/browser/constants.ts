/** Value sets of the browser context (checks, tries, recording, tabs): one list per mode, the union derived from it. */

/** How a check's row / a try came out: fine, worth a look, broken. */
export const QA_MARKS = ['ok', 'warn', 'fail'] as const
export type QaMark = (typeof QA_MARKS)[number]

/** The profile the browser's pages live in (the section's tabs, the notes' browsers, a run «as the person»). */
export const BROWSER_PARTITION = 'persist:qa-browser'

/** What a tab's navigation buttons / keys do: back, forward, reload (`hard` — without the cache), stop, its DevTools. */
export const NAV_ACTIONS = ['back', 'fwd', 'reload', 'hard', 'stop', 'devtools'] as const
export type NavAction = (typeof NAV_ACTIONS)[number]

/** A saved-password offer answered: keep it, not now, never for this site. */
export const PW_ANSWERS = ['save', 'no', 'never'] as const
export type PwAnswer = (typeof PW_ANSWERS)[number]

/** A page's keys that are the section's own (sent to the window): a new tab, the address line… */
export const PAGE_KEY_COMMANDS = ['newTab', 'reopenTab', 'closeTab', 'focusUrl', 'bookmark', 'device', 'history', 'terminal'] as const
export type PageKeyCommand = (typeof PAGE_KEY_COMMANDS)[number]

/** A download's state: going, or how it ended (Electron's DownloadItem states). */
export const DOWNLOAD_STATES = ['progress', 'completed', 'cancelled', 'interrupted'] as const
export type DownloadState = (typeof DOWNLOAD_STATES)[number]
