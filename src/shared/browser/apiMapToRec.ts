import type { ApiEndpoint, ApiSample } from '../apiMap'
import type { RecFull } from './recording'

/**
 * «Карта API» → the HTTP section: each endpoint's call the map kept (a good one, else a failed one) as a recorded
 * request — its address, headers and body as sent — so the picked ones go the recording's way (`recordingToHttp`:
 * the server's address and the secrets into variables, values from answers used later linked). In the order they
 * were made: an answer can feed only a later request.
 */
export function apiMapRecs(endpoints: readonly ApiEndpoint[]): RecFull[] {
  return endpoints
    .flatMap((e) => {
      const s = e.sample ?? e.errSample
      return s ? [{ e, s }] : []
    })
    .sort((a, b) => a.s.at - b.s.at)
    .map(({ e, s }, i) => recOf(e, s, i))
}

const contentTypeOf = (h?: Array<[string, string]>) => h?.find(([k]) => k.toLowerCase() === 'content-type')?.[1]

function recOf(e: ApiEndpoint, s: ApiSample, i: number): RecFull {
  const reqHeaders = [...(s.reqHeaders ?? [])]
  // the request's type known to the map only (headers not kept): told, so the body is read as what it is
  if (s.reqBody !== undefined && s.contentType && !contentTypeOf(reqHeaders)) reqHeaders.push(['Content-Type', s.contentType])
  const mimeType = contentTypeOf(s.resHeaders)?.split(';')[0].trim()
  return {
    id: e.key,
    seq: i + 1,
    tabId: '',
    at: s.at,
    method: e.method,
    url: s.url,
    type: 'Fetch',
    status: s.status,
    reqHeaders,
    ...(s.reqBody !== undefined ? { postData: s.reqBody } : {}),
    ...(s.resHeaders ? { resHeaders: s.resHeaders } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(s.resBody !== undefined ? { resBody: s.resBody } : {}),
  }
}
