/**
 * The recording of the requests a page sends (XHR / fetch, and the documents if asked) — and a Playwright scenario
 * recorded in a tab: what the main process keeps and the window shows.
 */

/** A recorded request, as the list shows it. */
export interface RecItem {
  id: string
  /** The order it was sent in (the whole recording). */
  seq: number
  tabId: string
  /** When it was sent (ms since 1970). */
  at: number
  method: string
  url: string
  /** XHR, Fetch or Document. */
  type: string
  status?: number
  /** How long it took, ms. */
  ms?: number
  error?: string
  /** The answer's size, bytes. */
  size?: number
}
/** …with everything: the real headers (cookies too), the body, the answer. */
export interface RecFull extends RecItem {
  reqHeaders: Array<[string, string]>
  postData?: string
  resHeaders?: Array<[string, string]>
  mimeType?: string
  /** The answer's text (JSON, text) — cut at 1 MB; none for pictures and files. */
  resBody?: string
}
export interface RecState {
  on: boolean
  /** Also the pages themselves (the document a tab opens), not only XHR / fetch. */
  documents: boolean
  count: number
}
/** A recorded request without its headers and bodies (the list's row). */
export const recSummary = (x: RecFull): RecItem => ({ id: x.id, seq: x.seq, tabId: x.tabId, at: x.at, method: x.method, url: x.url, type: x.type, status: x.status, ms: x.ms, error: x.error, size: x.size })

/** A Playwright scenario being recorded in a tab (for a note's block). */
export interface PwRecState {
  note: string
  key: string
  tabId: string
  count: number
  /** The last line written. */
  last?: string
}
