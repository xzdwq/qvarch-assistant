import { findLinks, type RecFull } from '../../shared/browser'
import { apiPath } from '../../shared/apiMap'
import { MUT, type Exchange } from './traffic'

/**
 * What a check's result rests on: from a run's traffic, the requests that are the action itself — not every request
 * the page happened to send (its polling, its error reporter, its analytics, whatever comes next). Each kind of action
 * has its adapter:
 *  - upload(file): the request carrying the file (its name in a multipart part, or its bytes), and the requests that
 *    then use what its answer gave (the file's id → processing → import);
 *  - endpoints(keys): the requests to the endpoints a person pinned («это — загрузка»).
 * An adapter picks; it never filters by a list of known services.
 */
export interface OutcomeAdapter {
  /** In words, for the result («по содержимому файла», «привязано: POST /api/import»). */
  what: string
  pick(run: Exchange[]): Exchange[]
}

/** An endpoint as a person reads and pins it: «POST /api/files/:id/import» (ids as :id, no host, no query). */
export const endpointOf = (x: Pick<Exchange, 'method' | 'url'>) => `${x.method.toUpperCase()} ${apiPath(x.url).path}`

/** The requests that use, in turn, what the answers of `roots` gave (an id, a token) — the chain from them. */
export function chainFrom(run: Exchange[], roots: Exchange[]): Exchange[] {
  if (!roots.length) return []
  const items: RecFull[] = run.map((x, j) => ({
    id: String(j),
    seq: j,
    tabId: '',
    at: x.at,
    method: x.method,
    url: x.url,
    type: x.type,
    reqHeaders: Object.entries(x.reqHeaders),
    ...(x.body !== undefined ? { postData: x.body } : {}),
    ...(x.res !== undefined ? { resBody: x.res } : {}),
  }))
  const links = findLinks(items)
  const inChain = new Set(roots.map((r) => run.indexOf(r)).filter((j) => j >= 0))
  // (a link's source in the chain → its uses join it; again, till nothing new)
  for (let grew = true; grew; ) {
    grew = false
    for (const l of links)
      if (inChain.has(l.from))
        for (const u of l.uses)
          if (!inChain.has(u.to)) {
            inChain.add(u.to)
            grew = true
          }
  }
  return run.filter((_, j) => inChain.has(j))
}

/** The file in a request: its name in a multipart part's header, or its first bytes in the body as they are / base64. */
export function carries(x: Exchange, file: { name: string; bytes: Buffer }): boolean {
  if (!x.bytes?.length) return false
  if (x.bytes.includes(Buffer.from(`filename="${file.name}"`))) return true
  const head = file.bytes.subarray(0, Math.min(64, file.bytes.length))
  if (head.length >= 16 && x.bytes.includes(head)) return true
  const b64 = file.bytes.subarray(0, 48).toString('base64')
  return b64.length >= 32 && x.bytes.includes(Buffer.from(b64))
}

/**
 * A file's upload: the request seen carrying it while recording (its endpoint, when the scenario has it), else the one
 * carrying it now — and the requests that follow from its answer.
 */
export function upload(file: { name: string; bytes: Buffer }, recorded?: string): OutcomeAdapter {
  return {
    what: recorded ? `загрузка из записи: ${recorded}` : 'по содержимому файла',
    pick: (run) => chainFrom(run, run.filter((x) => (recorded ? endpointOf(x) === recorded : carries(x, file)))),
  }
}
export function endpoints(keys: string[]): OutcomeAdapter {
  const want = new Set(keys)
  return {
    what: `привязано: ${keys.join(', ')}`,
    pick: (run) => run.filter((x) => want.has(endpointOf(x))),
  }
}
/**
 * How many of the values typed a request's body carries — as they are, JSON-escaped, or URL-encoded (a form, a
 * multipart part): a form's save is the request carrying what was typed into it, whatever else the page sends.
 */
export function valuesIn(body: string | undefined, values: string[]): number {
  if (!body) return 0
  return values.filter((v) => {
    const t = v.trim()
    if (t.length < 2) return false
    return body.includes(t) || body.includes(JSON.stringify(t).slice(1, -1)) || body.includes(encodeURIComponent(t)) || body.includes(encodeURIComponent(t).replace(/%20/g, '+'))
  }).length
}
/** The save of a form: the changing request carrying the most of the values typed (the latest of equals); none — none carries them. */
export function saveOf<T extends { body?: string }>(changes: T[], values: string[]): T | undefined {
  let best: T | undefined
  let most = 0
  for (const x of changes) {
    const n = valuesIn(x.body, values)
    if (n > 0 && n >= most) ((best = x), (most = n))
  }
  return best
}
/** The changing requests of a run, by endpoint (a person picks the one to pin among them). */
export function changes(run: Exchange[]): Exchange[] {
  return run.filter((x) => MUT.test(x.method))
}
