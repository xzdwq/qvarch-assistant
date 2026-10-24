import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { FAIL_TEXT, parseClientFrame, PROTOCOL_VERSION, TRANSPORT_PATH, type ClientFrame, type FailCode, type ServerFrame, type TransportEvent } from '../../src/shared/transport/protocol'
import { Bucket, checkProof, checkSignature, deviceIdOf } from './auth'
import type { ServerConfig } from './config'
import type { Db } from './db'
import { migrate } from './migrate'
import { Bus, RpcFail, type Delivery, type Method, type ModuleFactory, type ServerContext, type ServerModule, type Session } from './module'
import { DbFlags, Devices } from './modules/core'

/** Limits of one connection: the frame size, the time to sign in, silence before it is dropped, requests a second. */
const MAX_FRAME = 256 * 1024
const AUTH_MS = 10_000
const IDLE_MS = 90_000
const SWEEP_MS = 30_000
const BURST = 40
const PER_SEC = 10

/** One connection: signed in or still being asked. */
class Conn {
  readonly nonce = randomBytes(32).toString('base64')
  readonly bucket = new Bucket(BURST, PER_SEC)
  session?: Session
  seen = Date.now()
  constructor(readonly ws: WebSocket) {}
  send(f: ServerFrame): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(f))
  }
  fail(code: FailCode, message = FAIL_TEXT[code]): void {
    this.send({ t: 'fail', code, message })
    this.ws.close(4000, code)
  }
}

export interface Transport {
  port: number
  close(): Promise<void>
}

/** Every module's method by its full name; a method outside its module's namespace is a mistake of the code. */
function methodTable(modules: readonly ServerModule[]): Map<string, Method> {
  const table = new Map<string, Method>()
  for (const m of modules)
    for (const [name, fn] of Object.entries(m.methods ?? {})) {
      if (!name.startsWith(`${m.name}.`)) throw new Error(`метод ${name} вне пространства модуля ${m.name}`)
      table.set(name, fn)
    }
  return table
}

/**
 * The transport server: the modules made and their schema migrated, one HTTP server for `/health` and the socket
 * (`/v1`). A connection signs in by its key, then asks (methods of the modules) and is told (their events).
 */
export async function startTransport(config: ServerConfig, db: Db, factories: readonly ModuleFactory[]): Promise<Transport> {
  /** Every connection; the signed-in ones by device (one device may have several). */
  const conns = new Set<Conn>()
  const online = new Map<string, Set<Conn>>()
  const delivery: Delivery = {
    send(devices: readonly string[], ev: TransportEvent) {
      const frame: ServerFrame = { t: 'ev', ...ev }
      for (const d of devices) for (const c of online.get(d) ?? []) c.send(frame)
    },
  }
  const ctx: ServerContext = { config, db, bus: new Bus(), delivery, flags: new DbFlags(db) }
  const modules = factories.map((f) => f(ctx))
  const methods = methodTable(modules)
  const applied = await migrate(db, modules)
  if (applied.length) console.log('migrations:', applied.join(', '))
  const devices = new Devices(db)

  async function signIn(c: Conn, f: Extract<ClientFrame, { t: 'auth' }>): Promise<void> {
    if (f.v !== PROTOCOL_VERSION) return c.fail('version')
    if (!checkSignature(f.key, c.nonce, f.sig)) return c.fail('auth')
    if (!checkProof(config.accessCode, c.nonce, f.proof)) return c.fail('code')
    const session: Session = { device: await devices.signIn(deviceIdOf(f.key), f.key, f.name) }
    c.session = session
    let set = online.get(session.device.id)
    if (!set) online.set(session.device.id, (set = new Set()))
    set.add(c)
    c.send({ t: 'ready', device: session.device })
    for (const m of modules) if (m.onReady) m.onReady(session).catch((e: Error) => console.error(`${m.name}.onReady:`, e.message))
  }

  async function answer(c: Conn, s: Session, f: Extract<ClientFrame, { t: 'req' }>): Promise<void> {
    if (!c.bucket.take()) return c.send({ t: 'res', id: f.id, err: { code: 'limit', message: 'Слишком много запросов' } })
    const fn = methods.get(f.m)
    if (!fn) return c.send({ t: 'res', id: f.id, err: { code: 'missing', message: `Нет метода ${f.m}` } })
    try {
      const p = f.p && typeof f.p === 'object' && !Array.isArray(f.p) ? (f.p as Record<string, unknown>) : {}
      c.send({ t: 'res', id: f.id, r: (await fn(p, s)) ?? null })
    } catch (e) {
      if (e instanceof RpcFail) return c.send({ t: 'res', id: f.id, err: { code: e.code, message: e.message } })
      console.error(`${f.m}:`, (e as Error).message)
      c.send({ t: 'res', id: f.id, err: { code: 'internal', message: 'Ошибка сервера' } })
    }
  }

  async function onFrame(c: Conn, raw: string): Promise<void> {
    c.seen = Date.now()
    const f = parseClientFrame(raw)
    if (!f) return c.ws.close(4001, 'bad frame')
    if (f.t === 'ping') return c.send({ t: 'pong' })
    if (!c.session) return f.t === 'auth' ? signIn(c, f) : c.fail('auth')
    if (f.t === 'req') return answer(c, c.session, f)
  }

  /** An HTTP request: the health check, else the first module that takes it. */
  async function onHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return void res.end(JSON.stringify({ ok: true, version: config.version, protocol: PROTOCOL_VERSION }))
    }
    for (const m of modules) if (m.http && (await m.http(req, res))) return
    res.writeHead(404).end()
  }
  const http: Server = createServer((req, res) => {
    onHttp(req, res).catch((e: Error) => {
      console.error('http:', e.message)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  const wss = new WebSocketServer({ server: http, path: TRANSPORT_PATH, maxPayload: MAX_FRAME })
  wss.on('connection', (ws) => {
    const c = new Conn(ws)
    conns.add(c)
    const authTimer = setTimeout(() => !c.session && ws.close(4002, 'auth timeout'), AUTH_MS)
    c.send({ t: 'hello', v: PROTOCOL_VERSION, nonce: c.nonce, server: config.version })
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(4001, 'binary')
      onFrame(c, data.toString()).catch((e: Error) => console.error('frame:', e.message))
    })
    ws.on('close', () => {
      clearTimeout(authTimer)
      conns.delete(c)
      const id = c.session?.device.id
      const set = id ? online.get(id) : undefined
      set?.delete(c)
      if (id && set && !set.size) {
        online.delete(id)
        for (const m of modules) m.onClose?.(c.session!)
      }
    })
    ws.on('error', () => undefined)
  })
  // a connection silent too long (a dropped network) is closed — the app pings every half a minute
  const sweep = setInterval(() => {
    for (const c of conns) if (Date.now() - c.seen > IDLE_MS) c.ws.terminate()
  }, SWEEP_MS)

  await new Promise<void>((ok) => http.listen(config.port, ok))
  const port = (http.address() as { port: number }).port
  return {
    port,
    close: async () => {
      clearInterval(sweep)
      for (const ws of wss.clients) ws.terminate()
      await new Promise<void>((ok) => wss.close(() => ok()))
      await new Promise<void>((ok) => http.close(() => ok()))
    },
  }
}
