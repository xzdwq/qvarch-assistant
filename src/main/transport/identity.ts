import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeKeys, type DeviceKeys } from './keys'

const FILE = 'transport-identity.bin'

interface Kept {
  keys: DeviceKeys
  /** The access code of the server ('' — none). */
  code: string
}

/**
 * This installation's key pair (made once, on the first start — the device stays itself across restarts) and the
 * server's access code: kept encrypted with the OS (safeStorage / DPAPI). Without the OS encryption nothing is
 * written: the key lives until the app closes (the server will meet a new device next time).
 */
export class Identity {
  private kept: Kept
  readonly persistent: boolean

  constructor(private readonly root: string) {
    this.persistent = safeStorage.isEncryptionAvailable()
    this.kept = this.read() ?? { keys: makeKeys(), code: '' }
    this.write()
  }
  get keys(): DeviceKeys {
    return this.kept.keys
  }
  get code(): string {
    return this.kept.code
  }
  setCode(code: string): void {
    this.kept = { ...this.kept, code: code.trim() }
    this.write()
  }

  private read(): Kept | undefined {
    const file = join(this.root, FILE)
    if (!this.persistent || !existsSync(file)) return undefined
    try {
      const k = JSON.parse(safeStorage.decryptString(readFileSync(file))) as Partial<Kept>
      return k.keys?.publicKey && k.keys.privateKey ? { keys: k.keys, code: k.code ?? '' } : undefined
    } catch {
      return undefined
    }
  }
  private write(): void {
    if (!this.persistent) return
    const file = join(this.root, FILE)
    writeFileSync(`${file}.tmp`, safeStorage.encryptString(JSON.stringify(this.kept)))
    renameSync(`${file}.tmp`, file)
  }
}
