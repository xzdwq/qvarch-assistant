import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { CdpBridge, type BridgePage, type BridgeTarget, type ClientMessage } from '../../shared/browser/cdpBridge'

/**
 * The bridge's door for the run's Playwright: a WebSocket on 127.0.0.1 only, its path a secret, one connection
 * taken (then no more listening), open while the run is. Not Chromium's debugging port: through it there is one page
 * and nothing else of the app.
 */

/** The page's protocol as the door needs it: the commands, the page itself, its messages, its end. */
export interface BridgeSource extends BridgePage {
  target(): Promise<BridgeTarget>
  /** The page's protocol messages (`sessionId` — an iframe's / a worker's; none — the page's own). */
  onEvent(fn: (method: string, params: Record<string, unknown>, sessionId?: string) => void): () => void
  /** The page gone (closed, its note closed). */
  onGone(fn: () => void): () => void
}
export interface OpenBridge {
  /** Where the run connects (connectOverCDP). */
  url: string
  /** Settled when the run has gone and the page has what the run set undone. */
  done: Promise<void>
  /** Closes the door (the run over or never connected): the same undo. */
  close(): Promise<void>
}

export async function openCdpBridge(src: BridgeSource, connectMs = 30_000): Promise<OpenBridge> {
  const target = await src.target()
  const secret = randomBytes(24).toString('hex')
  // (no Origin: a web page cannot open it — a browser always sends one)
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 512 * 1024 * 1024, verifyClient: ({ req }: { req: IncomingMessage }) => req.url === `/${secret}` && !req.headers.origin })
  await new Promise<void>((ok, fail) => {
    wss.once('listening', ok)
    wss.once('error', fail)
  })
  const port = (wss.address() as { port: number }).port
  let socket: WebSocket | undefined
  let bridge: CdpBridge | undefined
  const offs: Array<() => void> = []
  let finished: Promise<void> | undefined
  let settle!: () => void
  const done = new Promise<void>((ok) => (settle = ok))

  const finish = (): Promise<void> =>
    (finished ??= (async () => {
      clearTimeout(timer)
      offs.forEach((f) => f())
      wss.close()
      socket?.terminate()
      await bridge?.restore()
      settle()
    })())
  // nobody came (the run's process fell before connecting): the door shut
  const timer = setTimeout(() => void finish(), connectMs)

  wss.on('connection', (ws) => {
    if (socket) return ws.close()
    socket = ws
    // (came: the wait for it is over — the run goes on as long as it needs)
    clearTimeout(timer)
    // one connection: no more listening (the connection itself stays)
    wss.close()
    const b = (bridge = new CdpBridge(src, target, (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg))))
    offs.push(src.onEvent((method, params, sessionId) => b.event(method, params, sessionId)))
    offs.push(
      src.onGone(() => {
        b.pageGone()
        // what Playwright was told goes out before the door shuts
        setTimeout(() => void finish(), 200)
      }),
    )
    ws.on('message', (data) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(data)) as ClientMessage
      } catch {
        return
      }
      if (typeof msg?.id === 'number' && typeof msg.method === 'string') void b.handle(msg)
    })
    ws.on('close', () => void finish())
    ws.on('error', () => void finish())
  })
  return { url: `ws://127.0.0.1:${port}/${secret}`, done, close: finish }
}
