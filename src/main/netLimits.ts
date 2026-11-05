/**
 * How long main waits for the network. A request that hangs (a VPN, a proxy holding the socket) never holds a sync
 * or a transfer for ever: it fails, and the next try goes as usual.
 */

/** An API call: a question with a short answer. */
export const API_TIMEOUT_MS = 30_000
/** A file sent or fetched (up to tens of MB). */
export const TRANSFER_TIMEOUT_MS = 5 * 60_000

/** A request's init with its time limit (a signal of the caller's own kept — whichever ends first). */
export function withTimeout(init: RequestInit = {}, ms = API_TIMEOUT_MS): RequestInit {
  const limit = AbortSignal.timeout(ms)
  return { ...init, signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit }
}
