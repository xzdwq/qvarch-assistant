import type { JiraFacets, JiraIssue, JiraListQuery, JiraState, JiraVersion, MyTaskStatus } from '../../shared/jira'
import { JiraApi } from './jiraApi'
import { JiraAuth } from './jiraAuth'
import { JIRA_ISSUE_FIELDS, jiraIssueFrom, validProjectKeys } from './jiraIssueMapping'
import { findIssues, findVersions, withoutDescription } from './jiraQueries'
import { JiraSignIn } from './jiraSignIn'
import { JiraStorage, type JiraCache } from './jiraStorage'

const SYNC_MS = 10 * 60_000
/** Every task of the projects that is not done (a safety cap only). */
const ALL_LIMIT = 5000
/** The releases are asked again after this long. */
const VERSIONS_TTL_MS = 5 * 60_000

export interface JiraConfig {
  clientId?: string
  projects: string[]
  /** Preferred site (several Atlassian sites may be accessible). */
  site?: string
  /** How often the issues are fetched, minutes. */
  syncMin?: number
}

/**
 * Jira Cloud over OAuth 2.0 (3LO) with the user's own Atlassian app: sign-in in the browser, a one-off
 * local callback, tokens refreshed automatically. Secrets (client secret, tokens) are encrypted with
 * the OS (safeStorage / DPAPI) and never leave this machine; the issue cache is plain JSON.
 */
export class Jira {
  private readonly storage: JiraStorage
  private readonly auth: JiraAuth
  private readonly api: JiraApi
  private readonly signIn = new JiraSignIn()
  private cache: JiraCache
  private syncing = false
  private error?: string
  /** When the last error came (the list shows it beside the last good sync). */
  private errorAt?: number
  private timer?: NodeJS.Timeout
  private liteCache?: { from: JiraIssue[]; list: JiraIssue[] }
  private versionsCache?: { at: number; list: JiraVersion[] }

  constructor(
    root: string,
    private config: () => JiraConfig,
    private onChange: (s: JiraState) => void,
  ) {
    this.storage = new JiraStorage(root)
    this.cache = this.storage.readCache()
    this.auth = new JiraAuth(this.storage, () => this.config().clientId)
    this.api = new JiraApi(this.auth, () => this.cache.cloudId)
  }

  // ---------- state ----------

  state(): JiraState {
    const cfg = this.config()
    return {
      configured: !!cfg.clientId && this.auth.hasClientSecret,
      hasSecret: this.auth.hasClientSecret,
      // (QA_SNAP_JIRA — the pictures of development: the cached tasks without signing in)
      connected: (this.auth.signedIn || (!!process.env.QA_SNAP && process.env.QA_SNAP_JIRA === '1')) && !!this.cache.cloudId,
      account: this.cache.account,
      siteUrl: this.cache.siteUrl,
      syncing: this.syncing,
      syncedAt: this.cache.syncedAt,
      error: this.error,
      errorAt: this.error ? this.errorAt : undefined,
      // the windows get the list without the descriptions (they are asked for one task at a time)
      issues: this.lite(),
      starred: this.cache.starred,
      myStatus: this.cache.myStatus,
    }
  }
  /** The tasks without descriptions (made again only when the list changed). */
  private lite(): JiraIssue[] {
    if (this.liteCache?.from !== this.cache.issues) this.liteCache = { from: this.cache.issues, list: this.cache.issues.map(withoutDescription) }
    return this.liteCache.list
  }
  private changed(): void {
    this.onChange(this.state())
  }

  // ---------- releases (fix versions) ----------

  /** The releases of every project in the settings (kept for 5 minutes). */
  private async versions(): Promise<JiraVersion[]> {
    if (this.versionsCache && Date.now() - this.versionsCache.at < VERSIONS_TTL_MS) return this.versionsCache.list
    const list: JiraVersion[] = []
    for (const p of validProjectKeys(this.config().projects)) list.push(...(await this.api.projectVersions(p)))
    this.versionsCache = { at: Date.now(), list }
    return list
  }
  /** A page of the releases matching a search: the unreleased first, then the released ones. */
  async findVersions(q: string, offset: number, limit: number): Promise<{ items: JiraVersion[]; total: number; unreleased: number }> {
    return findVersions(await this.versions(), q, offset, limit)
  }
  /** The keys of every task in a release (any status). */
  async versionIssues(id: string): Promise<string[]> {
    if (!/^\d+$/.test(id)) return []
    return this.api.search(`fixVersion = ${id}`, ['summary'], 5000, (key) => key)
  }

  // ---------- tasks ----------

  /** One task in full (with its description). */
  issue(key: string): JiraIssue | undefined {
    return this.cache.issues.find((i) => i.key === key)
  }
  /** A page of the open tasks that match a search — by project, then due date and state; without the descriptions. */
  find(q: string, offset: number, limit: number, mode: 'list' | 'pick' = 'list', query?: JiraListQuery): { items: JiraIssue[]; total: number; facets: JiraFacets } {
    return findIssues(this.cache.issues, { q, offset, limit, mode, query, starred: this.cache.starred, today: new Date().toLocaleDateString('sv-SE') })
  }
  star(key: string, on: boolean): void {
    this.cache.starred = on ? [...new Set([...this.cache.starred, key])] : this.cache.starred.filter((k) => k !== key)
    this.storage.writeCache(this.cache)
    this.changed()
  }
  setMyStatus(key: string, status: MyTaskStatus | null): void {
    if (status) this.cache.myStatus[key] = status
    else delete this.cache.myStatus[key]
    this.storage.writeCache(this.cache)
    this.changed()
  }

  // ---------- the sync timer ----------

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
    this.signIn.close()
  }

  // ---------- sign-in ----------

  setSecret(secret: string): void {
    this.auth.setClientSecret(secret)
    this.changed()
  }
  /** Opens the Atlassian consent page; resolves once the local callback got the code and the tokens. */
  async login(): Promise<void> {
    const clientId = this.config().clientId
    if (!clientId || !this.auth.hasClientSecret) throw new Error('Укажите Client ID и Secret в настройках')
    try {
      await this.signIn.run(clientId, (code) => this.exchange(code))
    } catch (e) {
      // (a sign-in started again in its place: the new one tells how it went)
      if (!this.signIn.busy) {
        this.error = (e as Error).message
        this.changed()
      }
      throw e
    }
    this.error = undefined
    this.changed()
    void this.sync()
  }
  /** The code exchanged for tokens; the site (cloud id) this token works for and the account remembered. */
  private async exchange(code: string): Promise<void> {
    await this.auth.exchangeCode(code)
    const sites = await this.api.accessibleSites()
    const want = this.config().site?.replace(/\/+$/, '')
    const site = sites.find((s) => s.url === want) ?? sites.find((s) => s.scopes.some((x) => x.includes('jira'))) ?? sites[0]
    if (!site) throw new Error('Нет доступных сайтов Jira для этого входа')
    this.cache.cloudId = site.id
    this.cache.siteUrl = site.url
    const me = await this.api.myself()
    this.cache.account = me ? { accountId: me.accountId, name: me.displayName } : undefined
    this.storage.writeCache(this.cache)
  }
  logout(): void {
    this.auth.forgetTokens()
    this.cache = { issues: [], starred: this.cache.starred, myStatus: this.cache.myStatus }
    this.storage.writeCache(this.cache)
    this.error = undefined
    this.changed()
  }

  // ---------- sync ----------

  /** Every task of the projects that is not done (mine among them), and everything picked by hand. */
  async sync(): Promise<void> {
    if (this.syncing || !this.cache.cloudId) return
    const projects = validProjectKeys(this.config().projects)
    if (!projects.length) return
    this.syncing = true
    this.changed()
    try {
      const toIssue = (key: string, fields: Record<string, any>) => jiraIssueFrom(key, fields, this.cache.account?.accountId)
      const open = await this.api.search(`project in (${projects.join(',')}) AND statusCategory != Done ORDER BY updated DESC`, JIRA_ISSUE_FIELDS, ALL_LIMIT, toIssue)
      const byKey = new Map<string, JiraIssue>()
      for (const i of open) byKey.set(i.key, i)
      const missing = this.cache.starred.filter((k) => !byKey.has(k))
      if (missing.length) for (const i of await this.api.search(`key in (${missing.join(',')})`, JIRA_ISSUE_FIELDS, missing.length, toIssue)) byKey.set(i.key, i)
      this.cache.issues = [...byKey.values()]
      this.cache.syncedAt = Date.now()
      this.error = undefined
      this.storage.writeCache(this.cache)
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      this.errorAt = Date.now()
      console.warn('[jira] sync:', this.error)
    } finally {
      this.syncing = false
      this.changed()
    }
  }
}
