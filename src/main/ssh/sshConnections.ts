import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { BrowserWindow } from 'electron'
import { SSH_NEEDS_PASSWORD } from '../../shared/ssh/api'
import { checkHostKey } from './hostKeys'
import type { SshSessionStore } from './sessionStore'

/** A connection with nothing open on it (no tab, no transfer) and unused this long is closed. */
const IDLE_MS = 10 * 60_000
const READY_MS = 20_000
const KEEPALIVE_MS = 20_000

interface Conn {
  client: Client
  ready: Promise<void>
  /** What is open on it now (a terminal tab, a transfer): it stays while any is. */
  holds: number
  lastUse: number
  /** The explorer's channel (one, shared by its listings). */
  sftp?: Promise<SFTPWrapper>
}

/** A network error in plain words, by its code (the rest — as ssh2 says it). */
const NET_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'сервер отказал в подключении (порт закрыт или SSH не запущен)',
  ENOTFOUND: 'хост не найден',
  EAI_AGAIN: 'хост не найден (нет DNS)',
  ETIMEDOUT: 'сервер не ответил вовремя',
  EHOSTUNREACH: 'хост недоступен',
  ECONNRESET: 'соединение сброшено',
}
function connectError(e: unknown): Error {
  const err = e as Error & { code?: string; level?: string }
  if (err.level === 'client-authentication') return new Error(`${SSH_NEEDS_PASSWORD}: пароль не подошёл`)
  if (err.level === 'client-timeout') return new Error('Сервер не ответил вовремя')
  return new Error(`Не удалось подключиться: ${(err.code && NET_ERRORS[err.code]) || err.message}`)
}

/**
 * The SSH connections, one per session, made on first need: a terminal tab's shell, the explorer's SFTP, a channel per
 * transfer — all over it. Sign-in: the password (sent, else kept), also as the answer to the server's questions
 * (keyboard-interactive). The server's key — checked against known_hosts (asked when new or changed).
 */
export class SshConnections {
  private conns = new Map<string, Conn>()
  private readonly timer: NodeJS.Timeout

  constructor(
    private readonly store: SshSessionStore,
    private readonly window: () => BrowserWindow | undefined,
    private readonly onClosed: (id: string, reason: string) => void,
  ) {
    this.timer = setInterval(() => this.closeIdle(), 60_000)
  }

  /** The session's connection, made now or the one there (a password sent — tried, and kept when it fits and `save`). */
  async connect(id: string, password?: string, save = false): Promise<Client> {
    const had = this.conns.get(id)
    if (had && password === undefined) {
      await had.ready
      had.lastUse = Date.now()
      return had.client
    }
    if (had) this.drop(id, had)
    const s = this.store.get(id)
    if (!s) throw new Error('Сессия не найдена')
    const pass = password ?? this.store.password(id)
    if (!pass) throw new Error(`${SSH_NEEDS_PASSWORD}: для ${s.user}@${s.host} пароль не сохранён`)
    const client = new Client()
    const conn: Conn = { client, holds: 0, lastUse: Date.now(), ready: Promise.resolve() }
    conn.ready = new Promise<void>((ok, fail) => {
      let up = false
      client.on('ready', () => ((up = true), ok()))
      client.on('error', (e) => (up ? undefined : fail(connectError(e))))
      // the server asks questions instead of plain password sign-in: each one is the password
      client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => pass)))
      client.on('close', () => {
        if (this.conns.get(id) !== conn) return
        this.conns.delete(id)
        if (up) this.onClosed(id, 'соединение закрыто')
        else fail(new Error('Соединение закрыто сервером'))
      })
    })
    this.conns.set(id, conn)
    const cfg: ConnectConfig = {
      host: s.host,
      port: s.port,
      username: s.user,
      password: pass,
      tryKeyboard: true,
      readyTimeout: READY_MS,
      keepaliveInterval: KEEPALIVE_MS,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => void checkHostKey(s.host, s.port, key, this.window()).then(verify, () => verify(false)),
    }
    client.connect(cfg)
    try {
      await conn.ready
    } catch (e) {
      this.drop(id, conn)
      throw e
    }
    if (password !== undefined && save) this.store.keepPassword(id, password)
    return client
  }

  /** Something open on the connection (a tab, a transfer): it is not closed as idle until `release` is called. */
  hold(id: string): () => void {
    const c = this.conns.get(id)
    if (!c) return () => undefined
    c.holds++
    let done = false
    return () => {
      if (done) return
      done = true
      c.holds = Math.max(0, c.holds - 1)
      c.lastUse = Date.now()
    }
  }

  /** An interactive shell for a terminal tab (its size as the pane's). */
  async shell(id: string, cols: number, rows: number): Promise<ClientChannel> {
    const client = await this.connect(id)
    return new Promise((ok, fail) => client.shell({ term: 'xterm-256color', cols, rows }, (e, ch) => (e ? fail(e) : ok(ch))))
  }

  /** A command run on the server (no terminal: stdout and stderr apart, an exit code) — a notebook block's script. */
  async exec(id: string, command: string): Promise<ClientChannel> {
    const client = await this.connect(id)
    return new Promise((ok, fail) => client.exec(command, (e, ch) => (e ? fail(e) : ok(ch))))
  }

  /** The explorer's SFTP channel (made once; gone with its connection — made again on the next call). */
  async sftp(id: string): Promise<SFTPWrapper> {
    await this.connect(id)
    const c = this.conns.get(id)!
    c.lastUse = Date.now()
    if (!c.sftp) {
      const p: Promise<SFTPWrapper> = this.openSftp(c.client).then(
        (ch) => {
          // (the server closed it: the next listing opens another)
          ch.once('close', () => c.sftp === p && (c.sftp = undefined))
          return ch
        },
        (e) => {
          if (c.sftp === p) c.sftp = undefined
          throw e
        },
      )
      c.sftp = p
    }
    return c.sftp
  }
  /** An SFTP channel of its own (a transfer: the explorer's listings do not wait behind it); the caller ends it. */
  async ownSftp(id: string): Promise<SFTPWrapper> {
    return this.openSftp(await this.connect(id))
  }
  private openSftp(client: Client): Promise<SFTPWrapper> {
    return new Promise((ok, fail) => client.sftp((e, ch) => (e ? fail(e) : ok(ch))))
  }

  private closeIdle(): void {
    const now = Date.now()
    for (const [id, c] of this.conns) if (!c.holds && now - c.lastUse > IDLE_MS) this.drop(id, c)
  }
  private drop(id: string, c: Conn): void {
    if (this.conns.get(id) === c) this.conns.delete(id)
    try {
      c.client.end()
    } catch {
      // gone already
    }
  }
  /** On quit: every connection closed. */
  closeAll(): void {
    clearInterval(this.timer)
    for (const [id, c] of this.conns) this.drop(id, c)
  }
}
