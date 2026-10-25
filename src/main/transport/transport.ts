import { Notification } from 'electron'
import { join } from 'node:path'
import { attachWord, authorKey, authorName } from '../../shared/transport/chat'
import { httpBase, notifiesIn, socketUrl, type TransportState } from '../../shared/transport/constants'
import { TRANSPORT_PATH, type MethodName, type TransportEvent } from '../../shared/transport/protocol'
import type { AppContext } from '../app/appContext'
import { ChatFiles } from './chatFiles'
import { TransportClient, type ClientState } from './client'
import { Identity } from './identity'
import { SharedMedia, type MediaReport, type MediaWays, type SharedMediaAsk } from './sharedMedia'
import { SharedLog } from './sharedLog'
import { SharedResults } from './sharedResults'
import { SharedStates } from './sharedStates'
import { SpacePasses } from './spacePasses'
import { deviceIdOf, signerOf } from './keys'

/** The methods a window may call through the app (a new area opens its own prefix here). */
const WINDOW_PREFIXES = ['chat.', 'space.', 'doc.'] as const
export const windowMayCall = (m: string): m is MethodName => WINDOW_PREFIXES.some((p) => m.startsWith(p))

/** A notification's text: one line, not too long. */
const NOTE_MAX = 160

/**
 * The app's connection to the transport server: made from the settings (Настройки → Сервер и чат) and remade when
 * they change; its state and the server's events go to the windows; a message of someone else while the window is not in front — a
 * Windows notification (it does not take the focus), a click opens the chat (its block in a note, else a feed of the chats).
 */
export class Transport {
  private readonly identity: Identity
  private client?: TransportClient
  /** What the connection was made with (a change — a new connection). */
  private madeWith = ''
  /** The connection's last state. */
  private link: ClientState = { status: 'off' }
  /** The server's clock minus this computer's, as last known (kept while offline). */
  private skew?: number

  /** The shared notes' pictures and recordings. */
  private readonly media: SharedMedia
  /** The socket's address of the connection (none — not connected). */
  private socketUrl = ''

  /** The shared notes' run results. */
  readonly results: SharedResults
  /** The chats' files (pictures, documents sent into a chat). */
  readonly files: ChatFiles
  /** The shared documents' states kept here, the shared folders' links. */
  readonly states: SharedStates
  /** The shared notes' journal (what was asked for their files, what came of it). */
  readonly log: SharedLog

  constructor(private readonly app: AppContext) {
    this.identity = new Identity(app.store.root)
    const ask: SharedMediaAsk = (m, p) => this.client?.request(m, p) ?? Promise.reject(new Error('Сервер не подключён'))
    const base = () => (this.client && this.link.status === 'online' ? httpBase(this.socketUrl) : undefined)
    const passes = new SpacePasses(async (space) => (await ask('media.ticket', { space })).ticket)
    this.log = new SharedLog(app.store.root)
    this.media = new SharedMedia(app.vault, ask, passes, base, (l) => this.log.write(l))
    this.results = new SharedResults(passes, base)
    const roomPasses = new SpacePasses(async (room) => (await (this.client?.request('chat.fileTicket', { room }) ?? Promise.reject(new Error('Сервер не подключён')))).ticket)
    this.states = new SharedStates(app.store.root, app.vault.root)
    this.files = new ChatFiles(roomPasses, base, join(app.store.root, 'chat-files'))
  }
  /** A shared note's media in step with the server (the files fetched — returned). */
  syncMedia(space: string, rels: string[], ways?: MediaWays): Promise<MediaReport> {
    return this.media.sync(space, rels, ways)
  }

  /** The connection as the settings say now (none, the same, or a new one). */
  configure(): void {
    const { transport } = this.app.store.cfg
    const url = transport.enabled ? socketUrl(transport.url, TRANSPORT_PATH) : null
    const key = url ? JSON.stringify([url, transport.name, this.identity.code]) : ''
    if (key === this.madeWith) return
    this.madeWith = key
    this.client?.stop()
    this.client = undefined
    if (!url) {
      const typedWrong = transport.enabled && !!transport.url
      return this.setState(typedWrong ? { status: 'error', message: 'Не похоже на адрес сервера' } : { status: 'off' })
    }
    this.socketUrl = url
    this.client = new TransportClient({
      url,
      name: () => this.app.store.cfg.transport.name,
      signer: signerOf(this.identity.keys, () => this.identity.code),
      onState: (s) => this.setState(s),
      onEvent: (ev) => this.onEvent(ev),
    })
    this.client.start()
  }
  /** Connects anew at once (after an error, without waiting for the pause). */
  reconnect(): void {
    this.madeWith = ''
    this.configure()
  }
  setCode(code: string): TransportState {
    this.identity.setCode(code)
    this.configure()
    return this.state()
  }
  state(): TransportState {
    const s = this.link
    const persistent = this.identity.persistent ? undefined : 'Шифрование Windows недоступно: ключ устройства не сохранится после выхода'
    return {
      status: s.status,
      message: s.message ?? persistent,
      deviceId: deviceIdOf(this.identity.keys.publicKey),
      name: s.device?.name,
      server: s.server,
      hasCode: !!this.identity.code,
      ...(this.skew !== undefined ? { skew: this.skew } : {}),
    }
  }
  /** A window's request to the server (only the methods of the areas windows use). */
  call(m: string, p: unknown): Promise<unknown> {
    if (!windowMayCall(m)) return Promise.reject(new Error(`Метод ${m} недоступен`))
    if (!this.client) return Promise.reject(new Error('Сервер не подключён — Настройки → Сервер и чат'))
    return this.client.request(m, (p ?? {}) as never)
  }
  stop(): void {
    this.client?.stop()
  }

  private setState(s: ClientState): void {
    this.link = s
    if (s.skew !== undefined) this.skew = s.skew
    this.app.emitToAll('onTransport', this.state())
  }
  /** Each event's handling here (all of them go on to the main window). */
  /** What the app itself does with an event (the window handles its own: every event goes on to it). */
  private readonly EVENTS: { [K in TransportEvent['e']]?: (p: Extract<TransportEvent, { e: K }>['p']) => void } = {
    // (one's own agent's answer — told too: it is not one's own message)
    'chat.message': (m) => this.notify(m.room, authorKey(m), authorName(m), m.text || (m.attach ? attachWord(m.attach) : ''), !!m.mentions?.includes(this.link.device?.id ?? '')),
    'media.added': (p) => this.log.write(`event media.added ${p.space.slice(0, 8)} ${p.rels.join(', ')}`),
  }
  private onEvent(ev: TransportEvent): void {
    try {
      ;(this.EVENTS[ev.e] as ((p: unknown) => void) | undefined)?.(ev.p)
    } catch (e) {
      console.error(`${ev.e}:`, (e as Error).message)
    }
    this.app.emitToMain('onServer', ev)
  }
  /**
   * Someone else's message while the main window is not in front — when its chat is told (its own way, else the
   * common one; off by default); a mention of this device — unless its chat is silenced. A click opens it in the feed.
   */
  private notify(room: string, author: string, name: string, text: string, mentioned: boolean): void {
    const me = this.link.device?.id
    const w = this.app.windows.main
    const prefs = this.app.store.cfg.chat
    const told = notifiesIn(prefs, room) || (mentioned && prefs.rooms[room] !== false)
    if (author === me || !told || !Notification.isSupported()) return
    if (w && !w.isDestroyed() && w.isVisible() && w.isFocused()) return
    const body = text.replace(/\s+/g, ' ') || 'Вложение'
    const n = new Notification({ title: mentioned ? `${name} упомянул(а) вас` : name, body: body.length > NOTE_MAX ? `${body.slice(0, NOTE_MAX)}…` : body })
    n.on('click', () => {
      this.app.windows.showMain()
      this.app.emitToMain('onChatOpen', room)
    })
    n.show()
  }
}
