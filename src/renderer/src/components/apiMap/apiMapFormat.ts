import type { ApiEndpoint } from '@shared/apiMap'
import type { HttpExample } from '@shared/httpBlock'

/** How «Карта API» shows an endpoint's numbers and its example. */

/** A time: «120 мс», «1.5 с». */
export const ms = (n: number) => (n < 1000 ? `${n} мс` : `${(n / 1000).toFixed(1)} с`)
/** A moment: «05.03, 14:20». */
export const ago = (t: number) => new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
/** An endpoint's example as a request (none — never answered with a body kept). */
export const exampleOf = (e: ApiEndpoint): HttpExample | undefined => {
  const s = e.sample ?? e.errSample
  return s ? { method: e.method, url: s.url, body: s.reqBody, contentType: s.contentType } : undefined
}
