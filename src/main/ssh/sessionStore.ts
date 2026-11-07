import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { readJsonFile, writeJsonAtomic } from '../fsAtomic'
import { cleanSessionInput, type SshSession, type SshSessionInput } from '../../shared/ssh/sessions'

/** A session as kept on disk: its fields and its password encrypted by Windows (base64), if one is kept. */
type Stored = Omit<SshSession, 'hasPassword'> & { secret?: string }

/**
 * The saved SSH sessions in data/ssh-sessions.json. Passwords are encrypted by Windows for this user (safeStorage);
 * they leave this class only to connect — the window gets `hasPassword`.
 */
export class SshSessionStore {
  private readonly file: string
  private list: Stored[]

  constructor(root: string) {
    this.file = join(root, 'ssh-sessions.json')
    const raw = readJsonFile<{ sessions?: unknown[] }>(this.file)?.sessions ?? []
    this.list = raw.flatMap((x) => {
      const c = cleanSessionInput(x)
      const secret = (x as { secret?: unknown }).secret
      return c.ok && c.session.id ? [{ ...withoutPassword(c.session), ...(typeof secret === 'string' && secret ? { secret } : {}) }] : []
    })
  }

  sessions(): SshSession[] {
    return this.list.map(shown)
  }
  get(id: string): SshSession | undefined {
    const s = this.list.find((x) => x.id === id)
    return s && shown(s)
  }
  /** A session saved: a new id for a new one; its password kept, replaced or forgotten as sent. */
  save(input: SshSessionInput): SshSession {
    const c = cleanSessionInput(input)
    if (!c.ok) throw new Error(c.error)
    const { password, ...fields } = c.session
    const was = this.list.find((x) => x.id === fields.id)
    const next: Stored = { ...fields, id: was ? was.id : randomUUID() }
    const secret = password === undefined ? was?.secret : password ? encrypt(password) : undefined
    if (secret) next.secret = secret
    this.list = was ? this.list.map((x) => (x === was ? next : x)) : [...this.list, next]
    this.write()
    return shown(next)
  }
  remove(id: string): void {
    this.list = this.list.filter((x) => x.id !== id)
    this.write()
  }
  /** The session's kept password (none, or it cannot be read on this computer — undefined). */
  password(id: string): string | undefined {
    const secret = this.list.find((x) => x.id === id)?.secret
    if (!secret || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(secret, 'base64'))
    } catch {
      return undefined
    }
  }
  /** A password kept for a session (one that worked). */
  keepPassword(id: string, password: string): void {
    const s = this.list.find((x) => x.id === id)
    if (!s) return
    s.secret = encrypt(password)
    this.write()
  }
  private write(): void {
    writeJsonAtomic(this.file, { sessions: this.list }, 2)
  }
}

function withoutPassword(s: SshSessionInput): Omit<SshSession, 'hasPassword'> {
  const { password: _password, ...rest } = s
  return rest
}
function shown(s: Stored): SshSession {
  const { secret, ...rest } = s
  return { ...rest, hasPassword: !!secret }
}
/** A password encrypted by Windows (base64); encryption not there — refused (a password is never kept in the clear). */
function encrypt(password: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование Windows недоступно — пароль не сохранён')
  return safeStorage.encryptString(password).toString('base64')
}
