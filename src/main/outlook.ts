import { safeStorage, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { CALL_ACTIVITIES, type OutlookEvent, type OutlookResponse, type OutlookShowAs, type OutlookSource, type OutlookState } from '../shared/outlook'
import { readLocalOutlook } from './outlookLocal'
import { signInOutcomePage } from './signInPage'

/**
 * Outlook / Teams over Microsoft Graph with the user's own app registration (a public client: sign-in in
 * the browser with PKCE, no client secret, a one-off local callback on a free localhost port). Tokens are
 * encrypted with the OS (safeStorage / DPAPI) and never leave this machine. Read-only: calendar + presence.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0'
const SCOPES = 'offline_access User.Read Calendars.Read Presence.Read OnlineMeetings.Read User.ReadBasic.All'
const PRESENCE_MS = 30_000
/** The synced window: from two days back to two months ahead (the calendar scrolls into the future). */
const BACK_DAYS = 2
const AHEAD_DAYS = 60

export interface OutlookConfig {
  source: OutlookSource
  clientId?: string
  tenantId?: string
  syncMin: number
  meetings: boolean
  presence: boolean
}
interface Secrets {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}
interface Cache {
  account?: { name: string; email?: string }
  syncedAt?: number
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function writeAtomic(file: string, data: string | Buffer): void {
  writeFileSync(`${file}.tmp`, data)
  renameSync(`${file}.tmp`, file)
}

export class Outlook {
  private cache: Cache
  private secrets: Secrets
  private syncing = false
  private error?: string
  private presence?: OutlookState['presence']
  private syncTimer?: NodeJS.Timeout
  private presenceTimer?: NodeJS.Timeout
  private server?: Server

  constructor(
    private root: string,
    private config: () => OutlookConfig,
    private onChange: (s: OutlookState) => void,
    /** Meetings of the window [from, to) (local midnights). */
    private onEvents: (events: OutlookEvent[], from: number, to: number) => void,
    /** The Teams status says the user is in a call (or no longer). */
    private onPresenceCall: (inCall: boolean) => void,
  ) {
    this.cache = this.readJson<Cache>('outlook.json') ?? {}
    this.secrets = this.readSecrets()
  }

  state(): OutlookState {
    const c = this.config()
    const local = c.source === 'local'
    return {
      source: c.source,
      configured: local || (!!c.clientId && !!c.tenantId),
      // the local Outlook needs no sign-in
      connected: local || !!this.secrets.refreshToken,
      account: local ? { name: 'Outlook на этом компьютере' } : this.cache.account,
      syncing: this.syncing,
      syncedAt: this.cache.syncedAt,
      error: this.error,
      presence: local ? undefined : this.presence,
    }
  }
  private changed(): void {
    this.onChange(this.state())
  }

  /** (Re)starts the timers — at start and after the settings changed. */
  start(): void {
    clearInterval(this.syncTimer)
    clearInterval(this.presenceTimer)
    if (!this.state().connected) return
    const c = this.config()
    void this.sync()
    this.syncTimer = setInterval(() => void this.sync(), Math.max(1, c.syncMin) * 60_000)
    // the Teams status exists only over Graph
    if (c.presence && c.source === 'graph') {
      void this.pollPresence()
      this.presenceTimer = setInterval(() => void this.pollPresence(), PRESENCE_MS)
    } else if (this.presence) {
      this.presence = undefined
      this.onPresenceCall(false)
    }
  }
  stop(): void {
    clearInterval(this.syncTimer)
    clearInterval(this.presenceTimer)
    this.server?.close()
  }

  logout(): void {
    this.stop()
    this.secrets = {}
    this.writeSecrets()
    this.cache = {}
    this.writeCache()
    this.error = undefined
    this.presence = undefined
    this.onPresenceCall(false)
    this.changed()
  }

  // ---------- sign-in (authorization code + PKCE, loopback redirect) ----------

  private authority(): string {
    return `https://login.microsoftonline.com/${encodeURIComponent(this.config().tenantId ?? 'organizations')}/oauth2/v2.0`
  }

  login(): Promise<void> {
    const { clientId, tenantId } = this.config()
    if (!clientId || !tenantId) return Promise.reject(new Error('Укажите Client ID и Tenant ID в настройках'))
    const state = b64url(randomBytes(16))
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    this.server?.close()
    return new Promise((resolve, reject) => {
      let redirect = ''
      const timeout = setTimeout(() => finish(new Error('Вход не завершён за 5 минут')), 5 * 60_000)
      const finish = (err?: Error) => {
        clearTimeout(timeout)
        this.server?.close()
        this.server = undefined
        this.error = err?.message
        this.changed()
        if (err) reject(err)
        else resolve()
      }
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', redirect)
        if (url.pathname !== '/') {
          res.writeHead(404).end()
          return
        }
        const page = (title: string, text: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(signInOutcomePage(title, text))
        }
        if (url.searchParams.get('state') !== state) {
          page('Не получилось', 'Неверный state — попробуйте войти ещё раз из приложения.')
          return finish(new Error('Неверный state в ответе Microsoft'))
        }
        const code = url.searchParams.get('code')
        if (!code) {
          const why = url.searchParams.get('error_description') ?? url.searchParams.get('error') ?? 'Microsoft не вернул код.'
          page('Вход не выполнен', why.replace(/</g, '&lt;'))
          return finish(new Error(why.split('\n')[0]))
        }
        this.token({ grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier })
          .then(() => this.loadAccount())
          .then(() => {
            page('Готово', 'Outlook подключён — вкладку можно закрыть.')
            finish()
            this.start()
          })
          .catch((e: Error) => {
            page('Не получилось', e.message.replace(/</g, '&lt;'))
            finish(e)
          })
      })
      server.on('error', (e) => finish(new Error(`Локальный вход не запустился: ${e.message}`)))
      // a free port: Azure accepts any port for a registered http://localhost of a desktop app
      server.listen(0, '127.0.0.1', () => {
        redirect = `http://localhost:${(server.address() as AddressInfo).port}`
        const q = new URLSearchParams({
          client_id: clientId,
          response_type: 'code',
          redirect_uri: redirect,
          response_mode: 'query',
          scope: SCOPES,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          prompt: 'select_account',
        })
        void shell.openExternal(`${this.authority()}/authorize?${q}`)
      })
      this.server = server
    })
  }

  private async token(body: Record<string, string>): Promise<void> {
    const res = await fetch(`${this.authority()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config().clientId ?? '', scope: SCOPES, ...body }),
    })
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (!res.ok || !data.access_token) {
      if (data.error === 'invalid_grant') this.secrets = {} // refresh token revoked / expired → sign in again
      throw new Error(`Microsoft: ${(data.error_description ?? data.error ?? String(res.status)).split('\r\n')[0]}`)
    }
    this.secrets.accessToken = data.access_token
    if (data.refresh_token) this.secrets.refreshToken = data.refresh_token
    this.secrets.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000
    this.writeSecrets()
  }

  private async accessToken(): Promise<string> {
    if (this.secrets.accessToken && (this.secrets.expiresAt ?? 0) > Date.now()) return this.secrets.accessToken
    if (!this.secrets.refreshToken) throw new Error('Нужно войти в Microsoft')
    await this.token({ grant_type: 'refresh_token', refresh_token: this.secrets.refreshToken })
    return this.secrets.accessToken!
  }

  private async api<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json', ...headers },
    })
    if (res.status === 401) {
      this.secrets.accessToken = undefined
      throw new Error('Microsoft: доступ отклонён — войдите заново')
    }
    if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as T
  }

  private async loadAccount(): Promise<void> {
    const me = await this.api<{ displayName?: string; mail?: string; userPrincipalName?: string }>('/me?$select=displayName,mail,userPrincipalName')
    this.cache.account = { name: me.displayName ?? me.userPrincipalName ?? '—', email: me.mail ?? me.userPrincipalName }
    this.writeCache()
  }

  // ---------- meetings ----------

  async sync(): Promise<void> {
    if (this.syncing || !this.state().connected) return
    this.syncing = true
    this.changed()
    try {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - BACK_DAYS).getTime()
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + AHEAD_DAYS + 1).getTime()
      const events = this.config().source === 'local' ? await readLocalOutlook(BACK_DAYS, AHEAD_DAYS) : await this.graphEvents(from, to)
      if (this.config().source === 'graph' && !this.cache.account) await this.loadAccount().catch(() => undefined)
      if (this.config().meetings) this.onEvents(events, from, to)
      this.cache.syncedAt = Date.now()
      this.writeCache()
      this.error = undefined
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.syncing = false
      this.changed()
    }
  }

  private async graphEvents(from: number, to: number): Promise<OutlookEvent[]> {
    {
      const q = new URLSearchParams({
        startDateTime: new Date(from).toISOString(),
        endDateTime: new Date(to).toISOString(),
        $select: 'id,subject,start,end,isAllDay,isCancelled,showAs,responseStatus,organizer,isOnlineMeeting,onlineMeeting,location,attendees',
        $orderby: 'start/dateTime',
        $top: '200',
      })
      type Raw = {
        id: string
        subject?: string
        start: { dateTime: string }
        end: { dateTime: string }
        isAllDay?: boolean
        isCancelled?: boolean
        showAs?: OutlookShowAs
        responseStatus?: { response?: OutlookResponse }
        organizer?: { emailAddress?: { name?: string; address?: string } }
        isOnlineMeeting?: boolean
        onlineMeeting?: { joinUrl?: string } | null
        location?: { displayName?: string }
        attendees?: unknown[]
      }
      const events: OutlookEvent[] = []
      // times come in UTC (Prefer header) without a zone suffix
      const utc = (s: string) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`)
      let next: string | undefined = `/me/calendarView?${q}`
      for (let page = 0; next && page < 20; page++) {
        const r: { value: Raw[]; '@odata.nextLink'?: string } = await this.api(next, { Prefer: 'outlook.timezone="UTC"' })
        for (const e of r.value)
          events.push({
            id: e.id,
            subject: e.subject ?? '',
            start: utc(e.start.dateTime),
            end: utc(e.end.dateTime),
            allDay: !!e.isAllDay,
            cancelled: !!e.isCancelled,
            showAs: e.showAs ?? 'busy',
            response: e.responseStatus?.response ?? 'none',
            organizer: e.organizer?.emailAddress?.name,
            online: !!e.isOnlineMeeting,
            joinUrl: e.onlineMeeting?.joinUrl,
            location: e.location?.displayName || undefined,
            attendees: e.attendees?.length ?? 0,
          })
        next = r['@odata.nextLink']
      }
      return events
    }
  }

  // ---------- Teams status ----------

  private async pollPresence(): Promise<void> {
    try {
      const p = await this.api<{ availability?: string; activity?: string }>('/me/presence')
      const prev = this.presence
      this.presence = { availability: p.availability ?? '', activity: p.activity ?? '', at: Date.now() }
      this.onPresenceCall(CALL_ACTIVITIES.includes(this.presence.activity))
      if (!prev || prev.activity !== this.presence.activity || prev.availability !== this.presence.availability) this.changed()
    } catch {
      // the status is a hint only — a failed poll is skipped
    }
  }

  // ---------- storage ----------

  private readJson<T>(name: string): T | undefined {
    const file = join(this.root, name)
    if (!existsSync(file)) return undefined
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return undefined
    }
  }
  private writeCache(): void {
    writeAtomic(join(this.root, 'outlook.json'), JSON.stringify(this.cache))
  }
  private readSecrets(): Secrets {
    const file = join(this.root, 'outlook-secrets.bin')
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(file))) as Secrets
    } catch {
      return {}
    }
  }
  private writeSecrets(): void {
    const file = join(this.root, 'outlook-secrets.bin')
    if (!Object.values(this.secrets).some(Boolean)) return rmSync(file, { force: true })
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — вход не сохранён')
    writeAtomic(file, safeStorage.encryptString(JSON.stringify(this.secrets)))
  }
}
