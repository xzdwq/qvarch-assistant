import type { Page, Request } from 'playwright-core'

/**
 * A run's traffic: every request of the page, in order — what it sent (the text, and the bytes: a file is found in
 * them), what came back (the status; the answer's text while bodies are kept). It names nothing as «good» or «noise»:
 * which requests a check's result rests on is an outcome adapter's business (outcome.ts).
 */
export interface Exchange {
  /** Its place in the run's traffic. */
  i: number
  method: string
  url: string
  /** The resource's kind (xhr, fetch, document, eventsource…). */
  type: string
  at: number
  /** Finished (answered, or failed — status 0). */
  done: boolean
  status?: number
  reqHeaders: Record<string, string>
  /** What it sent as text (a JSON, a form; a file's part too — as text). */
  body?: string
  /** What it sent as bytes (a file is looked for in them). */
  bytes?: Buffer
  /** The answer's text — kept for a changing request that failed, or for all while bodies are kept. */
  res?: string
  resType?: string
}
export const MUT = /^(POST|PUT|PATCH|DELETE)$/i
const FILES = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico|map)(\?|$)/i
const TEXT = /json|text|xml|javascript|problem/i
const MAX_TEXT = 2_000_000

export class Traffic {
  readonly list: Exchange[] = []
  private of = new Map<Request, Exchange>()
  private keeping = 0

  constructor(page: Page) {
    page.on('request', (r) => {
      const bytes = r.postDataBuffer() ?? undefined
      const x: Exchange = {
        i: this.list.length,
        method: r.method(),
        url: r.url(),
        type: r.resourceType(),
        at: Date.now(),
        done: false,
        reqHeaders: r.headers(),
        ...(bytes ? { bytes, body: bytes.length <= MAX_TEXT ? bytes.toString('utf8') : undefined } : {}),
      }
      this.list.push(x)
      this.of.set(r, x)
    })
    page.on('requestfinished', (r) => {
      const x = this.of.get(r)
      if (!x) return
      x.done = true
      void r.response().then(
        async (res) => {
          x.status = res?.status()
          if (!res) return
          x.resType = res.headers()['content-type'] ?? ''
          // the answer kept: a change that failed always (what the server said); anything textual while asked to
          const want = (MUT.test(x.method) && (x.status ?? 0) >= 400) || (this.keeping > 0 && /^(xhr|fetch|document)$/.test(x.type) && TEXT.test(x.resType))
          if (want) {
            const t = await res.text().catch(() => '')
            if (t.length <= MAX_TEXT) x.res = t
          }
        },
        () => (x.status = 0),
      )
    })
    page.on('requestfailed', (r) => {
      const x = this.of.get(r)
      if (x) ((x.done = true), (x.status = 0))
    })
  }
  /** Answers' texts kept from now on (a check that reads them); `off` — the call it returns. */
  keep(): () => void {
    this.keeping++
    let on = true
    return () => on && ((on = false), this.keeping--)
  }
  mark(): number {
    return this.list.length
  }
  /**
   * The bodies of the requests before `upto` let go (what was read from them is kept by the check): a run over many
   * files / tries does not hold every upload's bytes and every answer in memory; the requests themselves stay.
   */
  release(upto: number): void {
    for (let i = 0; i < upto && i < this.list.length; i++) {
      const x = this.list[i]
      x.bytes = undefined
      x.body = undefined
      x.res = undefined
    }
  }
  from(mark: number): Exchange[] {
    return this.list.slice(mark)
  }
  /** A request of the page's own data (not a script, a picture, a font). */
  static data(x: Exchange): boolean {
    return /^https?:/i.test(x.url) && !FILES.test(x.url)
  }
  /**
   * Holds the page busy: its own data on the way for under 5 s — a live connection (server events, a long poll) or a
   * request that never ends is not waited for: it would hold every wait to its limit.
   */
  static busy(x: Exchange): boolean {
    return !x.done && Traffic.data(x) && /^(xhr|fetch|document)$/.test(x.type) && Date.now() - x.at < 5000
  }
}
