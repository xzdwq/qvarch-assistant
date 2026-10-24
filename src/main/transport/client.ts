import { FAIL_TEXT, parseServerFrame, PROTOCOL_VERSION, type ClientFrame, type DeviceInfo, type FailCode, type MethodName, type RpcError, type ServerFrame, type TransportEvent, type TransportMethods } from '../../shared/transport/protocol'
import type { TransportStatus } from '../../shared/transport/constants'
import type { Signer } from './keys'

/** The pauses before reconnecting, one after another (the last one repeats). */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]
const PING_MS = 25_000
/** Nothing heard this long — the connection is dead (a dropped network says nothing). */
const DEAD_MS = 60_000
const REQUEST_MS = 15_000
/** Refusals that another try will not fix — until the settings change. */
const FINAL: ReadonlySet<FailCode> = new Set(['version', 'auth', 'code'])

export interface ClientState {
  status: TransportStatus
  message?: string
  device?: DeviceInfo
  server?: string
}
export interface ClientOptions {
  /** The socket's full address. */
  url: string
  name: () => string
  signer: Signer
  onState(s: ClientState): void
  onEvent(ev: TransportEvent): void
}

/** A request's refusal by the server. */
export class TransportError extends Error {
  constructor(
    readonly code: RpcError['code'] | 'offline' | 'timeout',
    message: string,
  ) {
    super(message)
  }
}

/**
 * One connection to the transport server (no Electron here — the server's tests drive it too): signs in on the
 * server's challenge, asks and waits for answers, hands the events on; a lost connection comes back by itself
 * after a growing pause, a dead one is noticed by its silence.
 */
export class TransportClient {
  private ws?: WebSocket
  private stopped = true
  private tries = 0
  private nextId = 1
  private heard = 0
  private retry?: ReturnType<typeof setTimeout>
  private ping?: ReturnType<typeof setInterval>
  private readonly pending = new Map<number, { ok: (r: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  state: ClientState = { status: 'off' }

  constructor(private readonly o: ClientOptions) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }
  stop(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.drop()
    this.set({ status: 'off' })
  }
  /** A method of the server; offline, refused or unanswered — a TransportError. */
  request<M extends MethodName>(m: M, p: TransportMethods[M]['p']): Promise<TransportMethods[M]['r']> {
    const ws = this.ws
    if (this.state.status !== 'online' || !ws) return Promise.reject(new TransportError('offline', 'Нет связи с сервером'))
    const id = this.nextId++
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        fail(new TransportError('timeout', 'Сервер не ответил'))
      }, REQUEST_MS)
      this.pending.set(id, { ok: ok as (r: unknown) => void, fail, timer })
      this.send({ t: 'req', id, m, p })
    })
  }

  private connect(): void {
    this.set({ status: 'connecting' })
    let ws: WebSocket
    try {
      ws = new WebSocket(this.o.url)
    } catch (e) {
      return this.lost((e as Error).message)
    }
    this.ws = ws
    this.heard = Date.now()
    let final = false
    ws.onmessage = (m) => {
      this.heard = Date.now()
      const f = typeof m.data === 'string' ? parseServerFrame(m.data) : null
      if (f?.t === 'fail') final = FINAL.has(f.code)
      if (f) this.onFrame(f)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.drop()
      if (!this.stopped && !final) this.lost('Нет связи с сервером')
    }
    ws.onerror = () => undefined
  }

  /** Each frame kind's handling. */
  private readonly FRAMES: { [K in ServerFrame['t']]: (f: Extract<ServerFrame, { t: K }>) => void } = {
    hello: (f) => {
      const { signer } = this.o
      this.send({ t: 'auth', v: PROTOCOL_VERSION, key: signer.publicKey, sig: signer.sign(f.nonce), proof: signer.proof(f.nonce), name: this.o.name() })
      this.state = { ...this.state, server: f.server }
    },
    ready: (f) => {
      this.tries = 0
      this.set({ status: 'online', device: f.device, server: this.state.server })
      clearInterval(this.ping)
      this.ping = setInterval(() => {
        if (Date.now() - this.heard > DEAD_MS) this.ws?.close()
        else this.send({ t: 'ping' })
      }, PING_MS)
    },
    fail: (f) => this.set({ status: 'error', message: FAIL_TEXT[f.code] ?? f.message }),
    res: (f) => {
      const p = this.pending.get(f.id)
      if (!p) return
      this.pending.delete(f.id)
      clearTimeout(p.timer)
      if (f.err) p.fail(new TransportError(f.err.code, f.err.message))
      else p.ok(f.r)
    },
    ev: (f) => this.o.onEvent({ e: f.e, p: f.p } as TransportEvent),
    pong: () => undefined,
  }
  private onFrame(f: ServerFrame): void {
    ;(this.FRAMES[f.t] as (x: ServerFrame) => void)(f)
  }

  /** The connection lost: tried again after a pause. */
  private lost(why: string): void {
    const ms = BACKOFF_MS[Math.min(this.tries++, BACKOFF_MS.length - 1)]
    this.set({ status: 'error', message: `${why} — повтор через ${Math.round(ms / 1000)} с` })
    clearTimeout(this.retry)
    this.retry = setTimeout(() => !this.stopped && this.connect(), ms)
  }
  /** The socket closed and forgotten; the questions to it — failed. */
  private drop(): void {
    clearInterval(this.ping)
    const ws = this.ws
    this.ws = undefined
    if (ws && ws.readyState <= 1) ws.close()
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.fail(new TransportError('offline', 'Связь с сервером прервалась'))
    }
    this.pending.clear()
  }
  private send(f: ClientFrame): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(f))
  }
  private set(s: ClientState): void {
    this.state = s
    this.o.onState(s)
  }
}
