import { net } from 'electron'
import { netReason } from './netReason'
import type { JiraSecrets, JiraStorage } from './jiraStorage'

export const ATLASSIAN_AUTH = 'https://auth.atlassian.com'
export const ATLASSIAN_API = 'https://api.atlassian.com'
/** The local port of the sign-in's callback. */
export const JIRA_CALLBACK_PORT = 47321
/** Where Atlassian sends the sign-in back (registered in the user's Atlassian app). */
export const JIRA_REDIRECT = `http://localhost:${JIRA_CALLBACK_PORT}/callback`
// offline_access → a refresh token (otherwise the sign-in would last an hour)
export const JIRA_SCOPES = 'read:jira-work read:jira-user offline_access'

/**
 * A request through Chromium's network (the system proxy and certificates — as the browser; Node's fetch knows
 * neither and says only «fetch failed»). A network failure is tried once more a moment later, then its reason is told.
 */
export async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await net.fetch(url, init)
    } catch (e) {
      if (attempt < 1) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      throw new Error(`Нет связи с ${new URL(url).host}: ${netReason(e)}`)
    }
  }
}

/** The OAuth 2.0 (3LO) tokens of the user's own Atlassian app: kept encrypted, refreshed when they run out. */
export class JiraAuth {
  private secrets: JiraSecrets

  constructor(
    private readonly storage: JiraStorage,
    private readonly clientId: () => string | undefined,
  ) {
    this.secrets = storage.readSecrets()
  }

  get hasClientSecret(): boolean {
    return !!this.secrets.clientSecret
  }
  /** Signed in (a refresh token is kept). */
  get signedIn(): boolean {
    return !!this.secrets.refreshToken
  }
  setClientSecret(secret: string): void {
    this.secrets.clientSecret = secret.trim() || undefined
    this.storage.writeSecrets(this.secrets)
  }
  /** Signed out: the tokens forgotten, the app's secret kept. */
  forgetTokens(): void {
    this.secrets = { clientSecret: this.secrets.clientSecret }
    this.storage.writeSecrets(this.secrets)
  }
  /** The code from the sign-in exchanged for tokens. */
  async exchangeCode(code: string): Promise<void> {
    await this.token({ grant_type: 'authorization_code', code, redirect_uri: JIRA_REDIRECT })
  }
  /** A valid access token (refreshed when it ran out). */
  async accessToken(): Promise<string> {
    if (this.secrets.accessToken && (this.secrets.expiresAt ?? 0) > Date.now()) return this.secrets.accessToken
    if (!this.secrets.refreshToken) throw new Error('Нужно войти в Jira')
    await this.token({ grant_type: 'refresh_token', refresh_token: this.secrets.refreshToken })
    return this.secrets.accessToken!
  }
  /** The access token was refused: the next request refreshes it (or asks to sign in). */
  dropAccessToken(): void {
    this.secrets.accessToken = undefined
  }

  /** Token endpoint: code exchange or refresh (refresh tokens rotate — the new one is kept). */
  private async token(body: Record<string, string>): Promise<void> {
    const res = await requestWithRetry(`${ATLASSIAN_AUTH}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId(), client_secret: this.secrets.clientSecret, ...body }),
    })
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string }
    if (!res.ok || !data.access_token) throw new Error(`Atlassian: ${data.error_description ?? data.error ?? res.status}`)
    this.secrets.accessToken = data.access_token
    if (data.refresh_token) this.secrets.refreshToken = data.refresh_token
    this.secrets.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000
    this.storage.writeSecrets(this.secrets)
  }
}
