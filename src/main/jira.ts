import { safeStorage, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import type { JiraIssue, JiraState, MyTaskStatus } from '../shared/jira'
import { adfToMarkdown } from '../shared/adf'

/**
 * Jira Cloud over OAuth 2.0 (3LO) with the user's own Atlassian app: sign-in in the browser, a one-off
 * local callback, tokens refreshed automatically. Secrets (client secret, tokens) are encrypted with
 * the OS (safeStorage / DPAPI) and never leave this machine; the issue cache is plain JSON.
 */
const AUTH = 'https://auth.atlassian.com'
const API = 'https://api.atlassian.com'
const PORT = 47321
const REDIRECT = `http://localhost:${PORT}/callback`
// offline_access → a refresh token (otherwise the sign-in would last an hour)
const SCOPES = 'read:jira-work read:jira-user offline_access'
const FIELDS = ['summary', 'status', 'project', 'issuetype', 'priority', 'duedate', 'timeoriginalestimate', 'timespent', 'assignee', 'updated', 'description', 'components', 'labels', 'fixVersions', 'parent', 'reporter', 'created']
const SYNC_MS = 10 * 60_000
const ALL_LIMIT = 300
/** The names of a list of Jira objects (components, versions), or nothing. */
const names = (v: unknown): string[] | undefined => {
  const out = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? '') : '')).filter(Boolean) : []
  return out.length ? out : undefined
}

interface Secrets {
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}
interface Cache {
  cloudId?: string
  siteUrl?: string
  account?: { accountId: string; name: string }
  syncedAt?: number
  issues: JiraIssue[]
  starred: string[]
  myStatus: Record<string, MyTaskStatus>
}

export interface JiraConfig {
  clientId?: string
  projects: string[]
  /** Preferred site (several Atlassian sites may be accessible). */
  site?: string
  /** How often the issues are fetched, minutes. */
  syncMin?: number
}

function writeAtomic(file: string, data: string | Buffer): void {
  writeFileSync(`${file}.tmp`, data)
  renameSync(`${file}.tmp`, file)
}

export class Jira {
  private cache: Cache
  private secrets: Secrets
  private syncing = false
  private error?: string
  private timer?: NodeJS.Timeout
  private server?: Server

  constructor(
    private root: string,
    private config: () => JiraConfig,
    private onChange: (s: JiraState) => void,
  ) {
    this.cache = { issues: [], starred: [], myStatus: {}, ...this.readJson<Cache>('jira.json') }
    this.secrets = this.readSecrets()
  }

  // ---------- state ----------

  state(): JiraState {
    const cfg = this.config()
    return {
      configured: !!cfg.clientId && !!this.secrets.clientSecret,
      hasSecret: !!this.secrets.clientSecret,
      connected: !!this.secrets.refreshToken && !!this.cache.cloudId,
      account: this.cache.account,
      siteUrl: this.cache.siteUrl,
      syncing: this.syncing,
      syncedAt: this.cache.syncedAt,
      error: this.error,
      issues: this.cache.issues,
      starred: this.cache.starred,
      myStatus: this.cache.myStatus,
    }
  }

  private changed(): void {
    this.onChange(this.state())
  }

  start(): void {
    if (this.state().connected) void this.sync()
    this.schedule()
  }

  /** (Re)starts the timer — at start and when the interval is changed in the settings. */
  schedule(): void {
    clearInterval(this.timer)
    const ms = Math.max(1, this.config().syncMin ?? SYNC_MS / 60_000) * 60_000
    this.timer = setInterval(() => this.state().connected && void this.sync(), ms)
  }

  stop(): void {
    clearInterval(this.timer)
    this.server?.close()
  }

  setSecret(secret: string): void {
    this.secrets.clientSecret = secret.trim() || undefined
    this.writeSecrets()
    this.changed()
  }

  star(key: string, on: boolean): void {
    this.cache.starred = on ? [...new Set([...this.cache.starred, key])] : this.cache.starred.filter((k) => k !== key)
    this.writeCache()
    this.changed()
  }

  setMyStatus(key: string, status: MyTaskStatus | null): void {
    if (status) this.cache.myStatus[key] = status
    else delete this.cache.myStatus[key]
    this.writeCache()
    this.changed()
  }

  logout(): void {
    this.secrets = { clientSecret: this.secrets.clientSecret }
    this.writeSecrets()
    this.cache = { issues: [], starred: this.cache.starred, myStatus: this.cache.myStatus }
    this.writeCache()
    this.error = undefined
    this.changed()
  }

  // ---------- sign-in ----------

  /** Opens the Atlassian consent page; resolves once the local callback got the code and the tokens. */
  login(): Promise<void> {
    const clientId = this.config().clientId
    if (!clientId || !this.secrets.clientSecret) return Promise.reject(new Error('Укажите Client ID и Secret в настройках'))
    const state = randomBytes(16).toString('hex')
    this.server?.close()
    return new Promise((resolve, reject) => {
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
        const url = new URL(req.url ?? '/', REDIRECT)
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }
        const page = (title: string, text: string) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!doctype html><meta charset="utf-8"><title>Qvarch</title><body style="font:16px system-ui;background:#11131a;color:#e2e8f0;display:grid;place-items:center;height:90vh"><div><h2>${title}</h2><p>${text}</p></div>`)
        }
        if (url.searchParams.get('state') !== state) {
          page('Не получилось', 'Неверный state — попробуйте войти ещё раз из приложения.')
          return finish(new Error('Неверный state в ответе Atlassian'))
        }
        const code = url.searchParams.get('code')
        if (!code) {
          page('Вход отменён', url.searchParams.get('error_description') ?? 'Atlassian не вернул код.')
          return finish(new Error(url.searchParams.get('error_description') ?? 'Вход отменён'))
        }
        this.exchange(code)
          .then(() => {
            page('Готово', 'Jira подключена — вкладку можно закрыть.')
            finish()
            void this.sync()
          })
          .catch((e: Error) => {
            page('Не получилось', e.message)
            finish(e)
          })
      })
      server.on('error', (e) => finish(new Error(`Порт ${PORT} занят: ${e.message}`)))
      server.listen(PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({
          audience: 'api.atlassian.com',
          client_id: clientId,
          scope: SCOPES,
          redirect_uri: REDIRECT,
          state,
          response_type: 'code',
          prompt: 'consent',
        })
        void shell.openExternal(`${AUTH}/authorize?${q}`)
      })
      this.server = server
    })
  }

  private async exchange(code: string): Promise<void> {
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT })
    // the site (cloud id) this token works for
    const sites = (await this.api<Array<{ id: string; url: string; name: string; scopes: string[] }>>(`${API}/oauth/token/accessible-resources`)) ?? []
    const want = this.config().site?.replace(/\/+$/, '')
    const site = sites.find((s) => s.url === want) ?? sites.find((s) => s.scopes.some((x) => x.includes('jira'))) ?? sites[0]
    if (!site) throw new Error('Нет доступных сайтов Jira для этого входа')
    this.cache.cloudId = site.id
    this.cache.siteUrl = site.url
    const me = await this.api<{ accountId: string; displayName: string }>(this.jiraUrl('/rest/api/3/myself'))
    this.cache.account = me ? { accountId: me.accountId, name: me.displayName } : undefined
    this.writeCache()
  }

  /** Token endpoint: code exchange or refresh (refresh tokens rotate — the new one is kept). */
  private async token(body: Record<string, string>): Promise<void> {
    const res = await fetch(`${AUTH}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.config().clientId, client_secret: this.secrets.clientSecret, ...body }),
    })
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (!res.ok || !data.access_token) throw new Error(`Atlassian: ${data.error_description ?? data.error ?? res.status}`)
    this.secrets.accessToken = data.access_token
    if (data.refresh_token) this.secrets.refreshToken = data.refresh_token
    this.secrets.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000
    this.writeSecrets()
  }

  private async accessToken(): Promise<string> {
    if (this.secrets.accessToken && (this.secrets.expiresAt ?? 0) > Date.now()) return this.secrets.accessToken
    if (!this.secrets.refreshToken) throw new Error('Нужно войти в Jira')
    await this.token({ grant_type: 'refresh_token', refresh_token: this.secrets.refreshToken })
    return this.secrets.accessToken!
  }

  private jiraUrl(path: string): string {
    return `${API}/ex/jira/${this.cache.cloudId}${path}`
  }

  private async api<T>(url: string, body?: unknown): Promise<T | undefined> {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      // revoked / expired refresh: a new sign-in is needed
      this.secrets.accessToken = undefined
      throw new Error('Jira: доступ отклонён — войдите заново')
    }
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as T
  }

  // ---------- sync ----------

  /** All pages of a JQL search (capped). */
  private async search(jql: string, limit: number): Promise<JiraIssue[]> {
    const out: JiraIssue[] = []
    let next: string | undefined
    do {
      const page = await this.api<{ issues: Array<{ key: string; fields: Record<string, any> }>; nextPageToken?: string; isLast?: boolean }>(
        this.jiraUrl('/rest/api/3/search/jql'),
        { jql, fields: FIELDS, maxResults: 100, ...(next ? { nextPageToken: next } : {}) },
      )
      for (const it of page?.issues ?? []) out.push(this.toIssue(it.key, it.fields))
      next = page?.isLast === false ? page.nextPageToken : undefined
    } while (next && out.length < limit)
    return out
  }

  private toIssue(key: string, f: Record<string, any>): JiraIssue {
    const cat = f.status?.statusCategory?.key
    return {
      key,
      summary: f.summary ?? '',
      status: f.status?.name ?? '',
      category: cat === 'done' ? 'done' : cat === 'indeterminate' ? 'indeterminate' : 'new',
      project: { key: f.project?.key ?? key.split('-')[0], name: f.project?.name ?? '' },
      type: f.issuetype?.name ?? '',
      priority: f.priority?.name,
      due: f.duedate ?? undefined,
      estimateSec: f.timeoriginalestimate ?? undefined,
      spentSec: f.timespent ?? undefined,
      assignee: f.assignee?.displayName,
      mine: !!f.assignee?.accountId && f.assignee.accountId === this.cache.account?.accountId,
      updated: f.updated ? Date.parse(f.updated) : 0,
      description: adfToMarkdown(f.description) || undefined,
      components: names(f.components),
      labels: Array.isArray(f.labels) && f.labels.length ? f.labels.map(String) : undefined,
      versions: names(f.fixVersions),
      parent: f.parent?.key ? { key: f.parent.key, summary: f.parent.fields?.summary ?? '' } : undefined,
      reporter: f.reporter?.displayName,
      created: f.created ? Date.parse(f.created) : undefined,
    }
  }

  /** Mine (open + recently closed), the open ones of the projects, and everything picked by hand. */
  async sync(): Promise<void> {
    if (this.syncing || !this.cache.cloudId) return
    const projects = this.config().projects.filter((p) => /^[A-Z][A-Z0-9_]+$/.test(p))
    if (!projects.length) return
    this.syncing = true
    this.changed()
    try {
      const inProjects = `project in (${projects.join(',')})`
      const mine = await this.search(`${inProjects} AND assignee = currentUser() AND (statusCategory != Done OR updated >= -14d) ORDER BY updated DESC`, 500)
      const open = await this.search(`${inProjects} AND statusCategory != Done ORDER BY updated DESC`, ALL_LIMIT)
      const byKey = new Map<string, JiraIssue>()
      for (const i of [...open, ...mine]) byKey.set(i.key, i)
      const missing = this.cache.starred.filter((k) => !byKey.has(k))
      if (missing.length) for (const i of await this.search(`key in (${missing.join(',')})`, missing.length)) byKey.set(i.key, i)
      this.cache.issues = [...byKey.values()]
      this.cache.syncedAt = Date.now()
      this.error = undefined
      this.writeCache()
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      this.syncing = false
      this.changed()
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
    writeAtomic(join(this.root, 'jira.json'), JSON.stringify(this.cache))
  }

  private readSecrets(): Secrets {
    const file = join(this.root, 'jira-secrets.bin')
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(file))) as Secrets
    } catch {
      return {}
    }
  }

  private writeSecrets(): void {
    const file = join(this.root, 'jira-secrets.bin')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — секреты не сохранены')
    if (!Object.values(this.secrets).some(Boolean)) return rmSync(file, { force: true })
    writeAtomic(file, safeStorage.encryptString(JSON.stringify(this.secrets)))
  }
}
