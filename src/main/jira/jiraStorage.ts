import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JiraIssue, MyTaskStatus } from '../../shared/jira'

/** The OAuth secrets: kept encrypted with the OS (safeStorage / DPAPI), never leave this machine. */
export interface JiraSecrets {
  clientSecret?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}
/** The site, the account and the tasks fetched — plain JSON. */
export interface JiraCache {
  cloudId?: string
  siteUrl?: string
  account?: { accountId: string; name: string }
  syncedAt?: number
  issues: JiraIssue[]
  starred: string[]
  myStatus: Record<string, MyTaskStatus>
}

const CACHE_FILE = 'jira.json'
const SECRETS_FILE = 'jira-secrets.bin'

/** Written to a side file first, then renamed over (never half a file). */
function writeAtomic(file: string, data: string | Buffer): void {
  writeFileSync(`${file}.tmp`, data)
  renameSync(`${file}.tmp`, file)
}

/** Jira's files in the app's folder: the task cache (JSON) and the encrypted secrets. */
export class JiraStorage {
  constructor(private readonly root: string) {}

  /** The cache as kept (an empty one when missing or broken). */
  readCache(): JiraCache {
    const empty: JiraCache = { issues: [], starred: [], myStatus: {} }
    const file = join(this.root, CACHE_FILE)
    if (!existsSync(file)) return empty
    try {
      return { ...empty, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<JiraCache>) }
    } catch {
      return empty
    }
  }
  writeCache(cache: JiraCache): void {
    writeAtomic(join(this.root, CACHE_FILE), JSON.stringify(cache))
  }

  /** The secrets (none when missing, unreadable or the OS cannot decrypt). */
  readSecrets(): JiraSecrets {
    const file = join(this.root, SECRETS_FILE)
    if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return {}
    try {
      return JSON.parse(safeStorage.decryptString(readFileSync(file))) as JiraSecrets
    } catch {
      return {}
    }
  }
  /** Keeps the secrets encrypted (none left — the file goes); without the OS encryption nothing is written. */
  writeSecrets(secrets: JiraSecrets): void {
    const file = join(this.root, SECRETS_FILE)
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — секреты не сохранены')
    if (!Object.values(secrets).some(Boolean)) return rmSync(file, { force: true })
    writeAtomic(file, safeStorage.encryptString(JSON.stringify(secrets)))
  }
}
