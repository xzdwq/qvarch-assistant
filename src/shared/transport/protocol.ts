import type { ChatAttach, ChatMessage, ChatRoom, CommentAnchor } from './chat'
import type { Space, SpaceKind, SpaceRole } from './space'

/** The HTTP path of a space's media files: `/media/<space>/<rel>`; the pass — in this header. */
export const MEDIA_PATH = '/media/'
export const TICKET_HEADER = 'x-qa-ticket'
/** A media file's size at most. */
export const MEDIA_MAX = 60 * 1024 * 1024

/**
 * The run results of a shared note: `GET /results/<space>/<doc>?since=<seq>` — what changed after that number,
 * `PUT` — this device's results (`{ entries: { key: value | null } }`, null — gone). The same pass as the media's.
 */
export const RESULTS_PATH = '/results/'
/**
 * The files of a chat: `PUT /chat-files/<room>/<id>` (its name — the `x-qa-name` header, encoded), `GET` — its bytes.
 * A member's pass of the room (`chat.fileTicket`).
 */
export const CHAT_FILES_PATH = '/chat-files/'
export const FILE_NAME_HEADER = 'x-qa-name'
export const RESULTS_MAX = 32 * 1024 * 1024
/** One result as the others get it: its value (none — taken away), who ran it, when it was kept. */
export interface SharedResult {
  value: unknown
  by: string
  device: string
  at: number
}
export interface ResultsPage {
  /** The last change's number (the next ask — after it). */
  seq: number
  entries: Record<string, SharedResult>
}

/**
 * The wire between the app and the transport server: one WebSocket, JSON frames. The server greets with a random
 * challenge, the app answers with its key's signature (no accounts) and, when the server has one, a proof of the
 * access code (an HMAC of the challenge — the code never travels). Then: requests with answers, and events.
 * A module of the server owns a namespace of methods and events (`chat.*`); a new module adds its own lines here.
 */
export const PROTOCOL_VERSION = 1
/** The socket's path (a new incompatible protocol gets a new one). */
export const TRANSPORT_PATH = '/v1'

/** Who is on the other end: an installation of the app (its key's fingerprint) or a server's own participant (a bot). */
export interface DeviceInfo {
  id: string
  name: string
  bot?: boolean
}

/** Why the server refused a connection. */
export const FAIL_CODES = ['version', 'auth', 'code', 'busy'] as const
export type FailCode = (typeof FAIL_CODES)[number]

/** A request's error (a refused or broken one). */
export interface RpcError {
  code: 'bad' | 'denied' | 'missing' | 'limit' | 'internal'
  message: string
}

/** The methods: what each takes (`p`) and answers (`r`). */
export interface TransportMethods {
  'core.rename': { p: { name: string }; r: DeviceInfo }
  'chat.rooms': { p: Record<string, never>; r: ChatRoom[] }
  'chat.history': { p: { room: string; before?: number; limit?: number }; r: ChatMessage[] }
  /** `mentions` — the members the text mentions (`@Имя`; others are dropped); `attach` — a block's result (the text may be empty then). */
  'chat.send': { p: { room: string; text: string; clientId: string; mentions?: string[]; attach?: ChatAttach }; r: ChatMessage }
  /** A chat of one's own (no one else yet — add people to it). */
  'chat.create': { p: { title?: string }; r: ChatRoom }
  /** A chat renamed (by the one who made it). */
  'chat.rename': { p: { room: string; title: string }; r: ChatRoom }
  /** The people one may add to a chat: those one shares a chat or a shared note with. */
  'chat.people': { p: Record<string, never>; r: DeviceInfo[] }
  /** The main conversation with one person (none — they never talked). */
  'chat.main': { p: { device: string }; r: ChatRoom | null }
  /**
   * A person added to a chat: `branch` — the chat becomes a branch of the main conversation with them (the main one —
   * made when none); `main` — the main conversation goes on instead (this chat, still one's own alone, is taken away).
   * The chat the block shows now.
   */
  'chat.add': { p: { room: string; device: string; as: 'branch' | 'main' }; r: ChatRoom }
  /** A reaction put / taken back (one of REACTIONS); the message as it is now. */
  'chat.react': { p: { room: string; seq: number; emoji: string; on: boolean }; r: ChatMessage }
  'chat.read': { p: { room: string; seq: number }; r: null }
  /** A pass for the room's files over HTTP (a member's). */
  'chat.fileTicket': { p: { room: string }; r: { ticket: string } }
  /**
   * A note shared: a new space with its document (`update` — its first state, Yjs, base64); a folder shared: a new
   * space without documents yet (they are added one by one).
   */
  'space.share': { p: { title: string; kind?: SpaceKind; update?: string }; r: { space: Space; doc?: string } }
  /** A note of a shared folder: its path (a taken one gets « (2)») and first state. */
  'space.addDoc': { p: { space: string; path: string; update: string }; r: { doc: string; path: string } }
  'space.moveDoc': { p: { doc: string; path: string }; r: { path: string } }
  /** Deleted for everyone (kept a while — `space.restoreDoc` brings it back). */
  'space.deleteDoc': { p: { doc: string }; r: null }
  'space.restoreDoc': { p: { doc: string }; r: { path: string } }
  /** Which of these media files the space's server copy lacks. */
  'media.missing': { p: { space: string; rels: string[] }; r: string[] }
  /** A pass for the media and run results of a space over HTTP (header `x-qa-ticket`): minutes long. */
  'media.ticket': { p: { space: string }; r: { ticket: string } }
  'space.list': { p: Record<string, never>; r: Space[] }
  'space.invite': { p: { space: string; role: SpaceRole }; r: { code: string } }
  'space.join': { p: { code: string }; r: Space }
  'space.setRole': { p: { space: string; device: string; role: SpaceRole }; r: Space }
  'space.remove': { p: { space: string; device: string }; r: Space }
  /** A member leaves; the owner — the space is deleted for everyone. */
  'space.leave': { p: { space: string }; r: null }
  /** A chat of the space: its members are the space's (new ones join it too). */
  'space.chat': { p: { space: string; title: string }; r: ChatRoom }
  /** A comment on a place of a shared document: a discussion of the space's members, its first message. */
  'space.comment': { p: { doc: string; anchor: CommentAnchor; text: string; clientId: string }; r: ChatRoom }
  /** A comment solved / opened again. */
  'space.resolve': { p: { room: string; resolved: boolean }; r: ChatRoom }
  /**
   * A document opened: what the server has that `sv` (the state vector the app has) lacks, the server's state vector
   * (the app sends what the server lacks), this device's role; the device is told the document's updates until closed.
   */
  'doc.open': { p: { doc: string; sv: string }; r: { update: string; sv: string; role: SpaceRole; space: string } }
  'doc.update': { p: { doc: string; update: string }; r: null }
  'doc.close': { p: { doc: string }; r: null }
}
export type MethodName = keyof TransportMethods
/** The events the server sends. */
export interface TransportEvents {
  'chat.message': ChatMessage
  'chat.room': ChatRoom
  'chat.typing': { room: string; device: DeviceInfo }
  /** A message changed (its reactions): shown anew, never told as a new one. */
  'chat.edited': ChatMessage
  /** A space as this member sees it now (members, roles, documents). */
  'space.changed': Space
  /** The space is gone for this device (deleted, or the device removed). */
  'space.gone': { space: string }
  /** Someone's edit of an open document. */
  'doc.update': { doc: string; update: string; by: string }
  /** Who has the document open now. */
  'doc.presence': { doc: string; devices: DeviceInfo[] }
  /** Media files came to a space (sent by a member): whoever lacks them fetches them. */
  'media.added': { space: string; rels: string[]; by: string }
  /** A shared note's run results changed (fetched over HTTP after `seq`). */
  'doc.results': { doc: string; seq: number; by: string }
}
export type EventName = keyof TransportEvents
export type TransportEvent = { [K in EventName]: { e: K; p: TransportEvents[K] } }[EventName]

export type ServerFrame =
  | { t: 'hello'; v: number; nonce: string; server: string }
  | { t: 'ready'; device: DeviceInfo }
  | { t: 'fail'; code: FailCode; message: string }
  | { t: 'res'; id: number; r?: unknown; err?: RpcError }
  | ({ t: 'ev' } & TransportEvent)
  | { t: 'pong' }

export type ClientFrame =
  | { t: 'auth'; v: number; key: string; sig: string; proof: string; name: string }
  | { t: 'req'; id: number; m: string; p: unknown }
  | { t: 'ping' }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown): x is string => typeof x === 'string'
const int = (x: unknown): x is number => Number.isSafeInteger(x)

/** Each frame kind's shape (a frame of an unknown kind or a broken one is not read). */
const CLIENT_SHAPES: { [K in ClientFrame['t']]: (o: Record<string, unknown>) => boolean } = {
  auth: (o) => int(o.v) && str(o.key) && str(o.sig) && str(o.proof) && str(o.name),
  req: (o) => int(o.id) && str(o.m),
  ping: () => true,
}
const SERVER_SHAPES: { [K in ServerFrame['t']]: (o: Record<string, unknown>) => boolean } = {
  hello: (o) => int(o.v) && str(o.nonce),
  ready: (o) => isObj(o.device) && str(o.device.id),
  fail: (o) => str(o.code) && str(o.message),
  res: (o) => int(o.id),
  ev: (o) => str(o.e),
  pong: () => true,
}

function parse<F extends { t: string }>(raw: string, shapes: Record<string, (o: Record<string, unknown>) => boolean>): F | null {
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(o) || !str(o.t) || !Object.hasOwn(shapes, o.t)) return null
  return shapes[o.t](o) ? (o as unknown as F) : null
}
/** A frame from the app as the server reads it (null — not a frame). */
export const parseClientFrame = (raw: string): ClientFrame | null => parse<ClientFrame>(raw, CLIENT_SHAPES)
/** A frame from the server as the app reads it. */
export const parseServerFrame = (raw: string): ServerFrame | null => parse<ServerFrame>(raw, SERVER_SHAPES)

/** The answer to a refused connection, in words for the person. */
export const FAIL_TEXT: Record<FailCode, string> = {
  version: 'Версия приложения и сервера несовместимы — обновите приложение',
  auth: 'Сервер не принял ключ этого устройства',
  code: 'Неверный код доступа к серверу',
  busy: 'Сервер перегружен — попробуйте позже',
}
