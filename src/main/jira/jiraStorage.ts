import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { readJsonFile, writeAtomic } from '../fsAtomic'
import { join } from 'node:path'
import type { JiraIssue } from '../../shared/jira'

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
  /** The tasks' ancestors not among them (the tree's upper levels: done, of other projects, above the epics). */
  parents?: JiraIssue[]
}

const CACHE_FILE = 'jira.json'
const SECRETS_FILE = 'jira-secrets.bin'


/** Jira's files in the app's folder: the task cache (JSON) and the encrypted secrets. */
export class JiraStorage {
  constructor(private readonly root: string) {}

  /** The cache as kept (an empty one when missing or broken). */
  readCache(): JiraCache {
    // (the hand-picked tasks and own marks of old caches are dropped)
    const { starred: _s, myStatus: _m, ...kept } = readJsonFile<Partial<JiraCache> & { starred?: unknown; myStatus?: unknown }>(join(this.root, CACHE_FILE)) ?? {}
    return { issues: [], ...kept }
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
