/**
 * Saved SSH sessions (as MobaXterm keeps them): where to connect and as whom, in folders. The password never comes
 * to the window — it only knows whether one is kept.
 */
export interface SshSession {
  id: string
  name: string
  /** The folder in the sessions' tree: 'Работа/Серверы' ('' — at the top). */
  folder: string
  host: string
  port: number
  user: string
  /** Where the file explorer opens ('' — the user's home on the server). */
  startDir: string
  /** The terminal's folder followed (a prompt hook typed in after sign-in — bash / zsh): the explorer and the path line use it. */
  followCwd: boolean
  /** A password is kept for it (encrypted; main has it, the window never does). */
  hasPassword: boolean
}
/** A session as the window sends it to be saved: its fields, and a new password (undefined — keep the one kept, '' — forget it). */
export type SshSessionInput = Omit<SshSession, 'hasPassword'> & { password?: string }

export const SSH_DEFAULT_PORT = 22
const MAX_TEXT = 255

const text = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** A folder path: its parts trimmed, empty ones dropped, joined by '/'. */
export function cleanFolder(v: unknown): string {
  return text(v, 1000)
    .split(/[\\/]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/')
}

/**
 * A session as sent (anything) → a valid one, or the reason it is not. The host and the user are needed; the port
 * is 1…65535 (none — 22); the name defaults to user@host.
 */
export function cleanSessionInput(v: unknown): { ok: true; session: SshSessionInput } | { ok: false; error: string } {
  const s = (v ?? {}) as Record<string, unknown>
  const host = text(s.host)
  const user = text(s.user)
  if (!host) return { ok: false, error: 'Укажите хост' }
  if (/\s/.test(host)) return { ok: false, error: 'В хосте не должно быть пробелов' }
  if (!user) return { ok: false, error: 'Укажите пользователя' }
  const port = s.port === undefined || s.port === '' ? SSH_DEFAULT_PORT : Number(s.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Порт — число от 1 до 65535' }
  const session: SshSessionInput = {
    id: text(s.id, 64),
    name: text(s.name) || `${user}@${host}`,
    folder: cleanFolder(s.folder),
    host,
    port,
    user,
    startDir: text(s.startDir, 4096),
    followCwd: s.followCwd !== false,
  }
  if (typeof s.password === 'string') session.password = s.password
  return { ok: true, session }
}

/** A folder of the sessions' tree: its sub-folders and its sessions, each sorted by name. */
export interface SessionFolder {
  name: string
  path: string
  folders: SessionFolder[]
  sessions: SshSession[]
}
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true })

/** The sessions as a tree of their folders (the root has the name ''). */
export function sessionTree(list: readonly SshSession[]): SessionFolder {
  const root: SessionFolder = { name: '', path: '', folders: [], sessions: [] }
  for (const s of list) {
    let at = root
    for (const part of s.folder ? s.folder.split('/') : []) {
      const path = at.path ? `${at.path}/${part}` : part
      let next = at.folders.find((f) => f.name === part)
      if (!next) at.folders.push((next = { name: part, path, folders: [], sessions: [] }))
      at = next
    }
    at.sessions.push(s)
  }
  const sort = (f: SessionFolder) => {
    f.folders.sort(byName)
    f.sessions.sort(byName)
    f.folders.forEach(sort)
  }
  sort(root)
  return root
}

/** How a session is shown in a tab: its name (the address when it has none of its own). */
export const sessionTitle = (s: Pick<SshSession, 'name' | 'user' | 'host'>) => s.name || `${s.user}@${s.host}`
