import { safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { writeAtomic } from '../fsAtomic'
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
  /**
   * The kept identity is there but could not be read (the OS encryption failed for a while, the file is damaged):
   * it is never overwritten — this run goes with keys of its own, the next start tries the file again.
   */
  readonly unreadable: boolean = false

  constructor(private readonly root: string) {
    this.persistent = safeStorage.isEncryptionAvailable()
    const read = this.read()
    if (read === 'unreadable') {
      this.unreadable = true
      console.error(`[transport] ${FILE} could not be read — kept as it is, this run uses a temporary device key`)
    }
    this.kept = typeof read === 'object' ? read : { keys: makeKeys(), code: '' }
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

  private read(): Kept | 'unreadable' | undefined {
    const file = join(this.root, FILE)
    if (!this.persistent || !existsSync(file)) return undefined
    try {
      const k = JSON.parse(safeStorage.decryptString(readFileSync(file))) as Partial<Kept>
      return k.keys?.publicKey && k.keys.privateKey ? { keys: k.keys, code: k.code ?? '' } : 'unreadable'
    } catch {
      return 'unreadable'
    }
  }
  private write(): void {
    if (!this.persistent || this.unreadable) return
    writeAtomic(join(this.root, FILE), safeStorage.encryptString(JSON.stringify(this.kept)))
  }
}
