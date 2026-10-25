import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanProfile, type AgentProfile, type AgentProfileView } from '../../shared/agent/profiles'

/**
 * This person's agents: the profiles (data/agents.json) and each one's key — encrypted by Windows (data/agent-keys.json),
 * never shown back, never in a note or a chat.
 */
export class AgentStore {
  private readonly file: string
  private readonly keysFile: string
  constructor(
    root: string,
    /** The owner's name now (a profile without a name gets «ИИ · <name>»). */
    private readonly owner: () => string,
  ) {
    this.file = join(root, 'agents.json')
    this.keysFile = join(root, 'agent-keys.json')
  }

  profiles(): AgentProfileView[] {
    const keys = this.keys()
    return this.read().map((p) => ({ ...p, hasKey: !!keys[p.id] }))
  }
  profile(id: string): AgentProfile | undefined {
    return this.read().find((p) => p.id === id)
  }
  /** Saved (new or changed); `key` given — kept (encrypted), '' — taken away, none — the old one stays. */
  save(input: unknown, key?: string): AgentProfileView[] {
    const p = cleanProfile(input, this.owner())
    const list = this.read()
    const at = list.findIndex((x) => x.id === p.id)
    if (at >= 0) list[at] = p
    else list.push(p)
    this.write(list)
    if (key !== undefined) this.setKey(p.id, key)
    return this.profiles()
  }
  remove(id: string): AgentProfileView[] {
    this.write(this.read().filter((p) => p.id !== id))
    this.setKey(id, '')
    return this.profiles()
  }
  /** A profile's key as given (none kept, or not readable on this computer — none). */
  key(id: string): string | undefined {
    const enc = this.keys()[id]
    if (!enc) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return undefined
    }
  }

  private setKey(id: string, key: string): void {
    const keys = this.keys()
    if (key.trim()) keys[id] = safeStorage.encryptString(key.trim()).toString('base64')
    else delete keys[id]
    this.writeJson(this.keysFile, keys)
  }
  private keys(): Record<string, string> {
    const k = this.readJson(this.keysFile)
    return k && typeof k === 'object' && !Array.isArray(k) ? (k as Record<string, string>) : {}
  }
  private read(): AgentProfile[] {
    const d = this.readJson(this.file) as { agents?: unknown[] } | undefined
    return Array.isArray(d?.agents) ? d.agents.map((x) => cleanProfile(x, this.owner())) : []
  }
  private write(list: AgentProfile[]): void {
    this.writeJson(this.file, { v: 1, agents: list })
  }
  private readJson(file: string): unknown {
    if (!existsSync(file)) return undefined
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return undefined
    }
  }
  private writeJson(file: string, v: unknown): void {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(v, null, 2))
    renameSync(tmp, file)
  }
}
