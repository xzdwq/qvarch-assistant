import type { PageLook } from './pageLook'

/**
 * The contract between the browser's pages (their preload, isolated from the site) and the main process: one
 * channel per message, named here once — the preload and main both take the names and payloads from this table.
 * What a page says is the page's word: main checks it before use.
 */

/** A login as a sign-in form holds it. */
export type PageLogin = { username: string; password: string }
/** The rulers over a page: on, and the guides pulled out of them (px from the left / the top). */
export type PageRuler = { on: boolean; v: number[]; h: number[] }
/** A recorded scenario's line from the page; `replace` — the same click just written (a double click stands for it). */
export type PageRecAct = {
  code: string
  note?: string
  replace?: string
  /** Files picked into a file field / dropped onto an element: kept with the notebook, the line made from them there. */
  files?: { how: 'input' | 'drop'; loc: string; paths: string[]; where: string; opener?: boolean }
}
/** A page recorded in: recording or not, how many lines so far. */
export type PageRecState = { on: boolean; count: number }

/** Main → page (no answer). */
export interface PageEvents {
  /** Record (or stop recording) this page's clicks and typing. */
  rec: [on: boolean]
  /** «Стоп»: write down what is not written yet, then say so (`recFlushed` with this id). */
  recFlush: [ackId: string]
  /** A saved login typed into the page's sign-in form. */
  pwFill: [login: PageLogin]
  ruler: [ruler: PageRuler]
  /** What may be acted on in this page (answered by `lookReply` with this id). */
  look: [id: string]
}
/** Page → main (no answer). */
export interface PageSends {
  recAct: [act: PageRecAct]
  recFlushed: [ackId: string]
  /** A sign-in form was sent: offer to keep the login. */
  pwSubmit: [login: PageLogin]
  rulerSet: [ruler: PageRuler]
  lookReply: [id: string, look: PageLook]
}
/** Page → main, answered. */
export interface PageAsks {
  recGet: PageRecState | null
  /** The site's saved login (the page's own origin only). */
  pwGet: PageLogin | null
  rulerGet: PageRuler | null
}
export type PageChannel = keyof PageEvents | keyof PageSends | keyof PageAsks

export const PAGE_CHANNELS = {
  rec: 'qa:pwrec',
  recFlush: 'qa:pwrec-flush',
  recFlushed: 'qa:pwrec-flushed',
  recAct: 'qa:pwrec-act',
  recGet: 'qa:pwrec-get',
  pwFill: 'qa:bpw-fill',
  pwSubmit: 'qa:bpw-submit',
  pwGet: 'qa:bpw-get',
  ruler: 'qa:ruler',
  rulerSet: 'qa:ruler-set',
  rulerGet: 'qa:ruler-get',
  look: 'qa:page-look',
  lookReply: 'qa:page-look-reply',
} as const satisfies Record<PageChannel, string>
