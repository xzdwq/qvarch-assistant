/** The app's connection to the transport server and its chat, as the person sets them (Настройки → Сервер и чат). */

/** How a message is sent from the input: Enter (Shift+Enter — a new line) or Ctrl+Enter (Enter — a new line). */
export const CHAT_SEND_KEYS = ['enter', 'ctrlEnter'] as const
export type ChatSendKey = (typeof CHAT_SEND_KEYS)[number]

export interface TransportPrefs {
  /** Connect at all. */
  enabled: boolean
  /** The server's address: `host:port`, `ws://…` or `wss://…`. */
  url: string
  /** The name others see next to this device's fingerprint. */
  name: string
}
export interface ChatPrefs {
  sendKey: ChatSendKey
  /** A Windows notification of a message while the window is not in front — for every chat not set its own way. */
  notifyAll: boolean
  /** A chat's own way (by room): notified / not, whatever the common setting. */
  rooms: Record<string, boolean>
}
/** Whether a chat's messages are told (its own way, else the common one). */
export const notifiesIn = (p: ChatPrefs, room: string): boolean => p.rooms[room] ?? p.notifyAll

export const DEFAULT_TRANSPORT: TransportPrefs = { enabled: false, url: '', name: '' }
export const DEFAULT_CHAT: ChatPrefs = { sendKey: 'enter', notifyAll: false, rooms: {} }
export const NAME_MAX = 60

/** The connection's state, as the windows show it. */
export const TRANSPORT_STATUSES = ['off', 'connecting', 'online', 'error'] as const
export type TransportStatus = (typeof TRANSPORT_STATUSES)[number]
export interface TransportState {
  status: TransportStatus
  /** Why it is not online (an error, a refusal) — for the person. */
  message?: string
  /** This device's id (its key's fingerprint) — known before any connection. */
  deviceId: string
  /** The name the server knows this device by (once online). */
  name?: string
  /** The server's version (once online). */
  server?: string
  /** An access code is kept for this server. */
  hasCode: boolean
  /** The server's clock minus this computer's, ms (the last known; none — never online). */
  skew?: number
}

/** The settings kept as read (unknown keys dropped, wrong values — the defaults). */
export function cleanTransport(raw: unknown): TransportPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<TransportPrefs>
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_TRANSPORT.enabled,
    url: typeof o.url === 'string' ? o.url.trim() : '',
    name: typeof o.name === 'string' ? o.name.trim().slice(0, NAME_MAX) : '',
  }
}
export function cleanChat(raw: unknown): ChatPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<ChatPrefs>
  return {
    sendKey: (CHAT_SEND_KEYS as readonly string[]).includes(o.sendKey as string) ? (o.sendKey as ChatSendKey) : DEFAULT_CHAT.sendKey,
    notifyAll: typeof o.notifyAll === 'boolean' ? o.notifyAll : DEFAULT_CHAT.notifyAll,
    rooms: Object.fromEntries(Object.entries(o.rooms && typeof o.rooms === 'object' ? o.rooms : {}).filter(([k, v]) => /^[0-9a-f-]{36}$/.test(k) && typeof v === 'boolean')),
  }
}

/** The server's HTTP address from its socket's (`ws://h:p/v1` → `http://h:p`). */
export const httpBase = (socket: string): string => socket.replace(/^ws(s?):\/\//, 'http$1://').replace(/^(https?:\/\/[^/]+).*$/, '$1')

/** The default port of the server (when the address has none). */
export const DEFAULT_PORT = 3000

/**
 * The socket's address from what the person typed: a bare host gets `ws://` and the default port, `http(s)://` turns
 * into `ws(s)://`; the path is the protocol's. Not an address — null.
 */
export function socketUrl(input: string, path: string): string | null {
  const s = input.trim()
  if (!s) return null
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `ws://${s}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  const SCHEMES: Record<string, string> = { 'ws:': 'ws:', 'wss:': 'wss:', 'http:': 'ws:', 'https:': 'wss:' }
  const scheme = SCHEMES[u.protocol]
  if (!scheme || !u.hostname) return null
  const port = u.port || (/^[a-z]+:\/\//i.test(s) ? '' : String(DEFAULT_PORT))
  return `${scheme}//${u.hostname}${port ? `:${port}` : ''}${path}`
}

/** Something that failed with the server (a sync, a send, a file) is tried again after these pauses — the last one from then on. */
export const RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000] as const
/** The pause before the next try after this many failures in a row (1 — the first). */
export const retryDelay = (fails: number): number => RETRY_MS[Math.min(Math.max(fails, 1), RETRY_MS.length) - 1]
