import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import * as Y from 'yjs'
import { isUuid } from '../../src/shared/transport/ids'
import type { DeviceInfo, RpcErrorCode, TransportEvent } from '../../src/shared/transport/protocol'
import type { ServerConfig } from './config'
import type { Db } from './db'
import type { PortRegistry } from './ports'
import type { Tickets } from './tickets'

/**
 * A module of the server: its own tables (migrations), its own methods (a namespace — `chat.*`), what it listens to
 * on the bus, the ports it answers for the others. The server is the modules of the registry (modules/index.ts):
 * presence, shared documents, analytics, tasks given to others — each a new module, nothing else changes.
 */
export interface ServerModule {
  /** Its name: the prefix of its methods and the key of its migrations. */
  name: string
  /** The schema step by step: the n-th applied once, as version n. A released step is never edited — a change is a new one. */
  migrations: readonly string[]
  methods?: Record<string, Method>
  /** A device's last connection closed. */
  onClose?(s: Session): void
  /** An HTTP request (files too big for the socket): answered — true; not its own — false. */
  http?(req: IncomingMessage, res: ServerResponse): Promise<boolean>
}
export type ModuleFactory = (ctx: ServerContext) => ServerModule

/** One signed-in connection's device. */
export interface Session {
  device: DeviceInfo
}
/** A method: the request's parameters (untrusted — checked by the method), the caller. */
export type Method = (p: Record<string, unknown>, s: Session) => Promise<unknown>

/** A refusal a method answers with (anything else thrown is an internal error, its text not shown). */
export class RpcFail extends Error {
  constructor(
    readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** What happens inside the server, for other modules (not sent anywhere by itself). */
export interface BusEvents {
  /** A device is no longer a member of a space (left, removed, the space deleted). */
  'space.left': { space: string; device: string }
}
export class Bus {
  private readonly em = new EventEmitter()
  on<K extends keyof BusEvents>(name: K, fn: (p: BusEvents[K]) => void): void {
    this.em.on(name, fn)
  }
  emit<K extends keyof BusEvents>(name: K, p: BusEvents[K]): void {
    this.em.emit(name, p)
  }
}

/** Who is connected and how to reach them. */
export interface Delivery {
  /** An event to every connection of these devices (the ones offline — nothing; they ask for what they missed). */
  send(devices: readonly string[], ev: TransportEvent): void
}

/** What a module gets. */
export interface ServerContext {
  config: ServerConfig
  db: Db
  bus: Bus
  delivery: Delivery
  /** The passes for files over HTTP (one key for every module: a space's pass serves its media and results). */
  tickets: Tickets
  /** What the modules ask of each other (each answered by the module owning the tables). */
  ports: PortRegistry
}

/** The parameter checks of a method: a wrong one — a refusal «bad». */
export function text(p: Record<string, unknown>, key: string): string {
  const v = p[key]
  if (typeof v !== 'string') throw new RpcFail('bad', `${key}: нужна строка`)
  return v
}
export function int(p: Record<string, unknown>, key: string, dflt?: number): number {
  const v = p[key] ?? dflt
  if (!Number.isSafeInteger(v)) throw new RpcFail('bad', `${key}: нужно целое число`)
  return v as number
}
export function uuid(p: Record<string, unknown>, key: string): string {
  const v = text(p, key)
  if (!isUuid(v)) throw new RpcFail('bad', `${key}: нужен идентификатор`)
  return v.toLowerCase()
}
/** A Yjs update from the wire (base64) — one that does not apply is refused. */
export function yjsUpdate(p: Record<string, unknown>, key: string): Uint8Array {
  const b64 = p[key]
  if (typeof b64 !== 'string' || !b64) throw new RpcFail('bad', `${key}: нужны данные документа`)
  const u = Buffer.from(b64, 'base64')
  try {
    Y.applyUpdate(new Y.Doc(), u)
  } catch {
    throw new RpcFail('bad', `${key}: это не данные документа`)
  }
  return u
}
