import type { JiraVersion } from '../../shared/jira'
import { ATLASSIAN_API, requestWithRetry, type JiraAuth } from './jiraAuth'

/** A JQL search page as Jira returns it. */
interface SearchPage<I> {
  issues: I[]
  nextPageToken?: string
  isLast?: boolean
}
/** An Atlassian site the sign-in may use. */
export interface AtlassianSite {
  id: string
  url: string
  name: string
  scopes: string[]
}

/** Jira Cloud's REST API v3 for the signed-in user, on the site (cloud id) picked at sign-in. */
export class JiraApi {
  constructor(
    private readonly auth: JiraAuth,
    private readonly cloudId: () => string | undefined,
  ) {}

  /** The sites this sign-in works for. */
  async accessibleSites(): Promise<AtlassianSite[]> {
    return (await this.call<AtlassianSite[]>(`${ATLASSIAN_API}/oauth/token/accessible-resources`)) ?? []
  }
  /** Who signed in. */
  myself(): Promise<{ accountId: string; displayName: string } | undefined> {
    return this.call(this.jiraUrl('/rest/api/3/myself'))
  }
  /** A project's releases (fix versions). */
  async projectVersions(project: string): Promise<JiraVersion[]> {
    const vs = await this.call<Array<{ id: string; name: string; released?: boolean; archived?: boolean; releaseDate?: string; description?: string }>>(this.jiraUrl(`/rest/api/3/project/${project}/versions`))
    return (vs ?? []).map((v) => ({ id: String(v.id), name: v.name, project, released: !!v.released, archived: !!v.archived, releaseDate: v.releaseDate, description: v.description }))
  }
  /** All pages of a JQL search (stops past `limit` found), each issue mapped. */
  async search<T>(jql: string, fields: string[], limit: number, map: (key: string, fields: Record<string, any>) => T): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined
    do {
      const page = await this.call<SearchPage<{ key: string; fields: Record<string, any> }>>(this.jiraUrl('/rest/api/3/search/jql'), {
        jql,
        fields,
        maxResults: 100,
        ...(next ? { nextPageToken: next } : {}),
      })
      for (const it of page?.issues ?? []) out.push(map(it.key, it.fields))
      next = page?.isLast === false ? page.nextPageToken : undefined
    } while (next && out.length < limit)
    return out
  }

  private jiraUrl(path: string): string {
    return `${ATLASSIAN_API}/ex/jira/${this.cloudId()}${path}`
  }
  /** A GET (or a POST with a JSON body) with the access token; 401 — the token is dropped, a new sign-in is asked. */
  private async call<T>(url: string, body?: unknown): Promise<T | undefined> {
    const res = await requestWithRetry(url, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${await this.auth.accessToken()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      // revoked / expired refresh: a new sign-in is needed
      this.auth.dropAccessToken()
      throw new Error('Jira: доступ отклонён — войдите заново')
    }
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as T
  }
}
