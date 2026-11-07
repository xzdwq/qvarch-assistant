import { ref } from 'vue'
import { SSH_DEFAULT_PORT, type SshSession } from '@shared/ssh/sessions'
import { remoteError } from '@shared/remoteError'

/** A session in the dialog: its fields, the password typed ('' — keep the kept one) and whether to forget it. */
export interface SessionDraft {
  id: string
  name: string
  folder: string
  host: string
  port: number
  user: string
  startDir: string
  followCwd: boolean
  password: string
  hasPassword: boolean
  forget: boolean
}

/** The session dialog: a new one (in a folder), one edited or copied; saved in main (a bad one — its reason shown). */
export function useSessionEditor() {
  const editing = ref<SessionDraft>()
  const error = ref('')
  const draftOf = (s: SshSession): SessionDraft => ({ ...s, password: '', forget: false })
  function addSession(folder = ''): void {
    error.value = ''
    editing.value = { id: '', name: '', folder, host: '', port: SSH_DEFAULT_PORT, user: '', startDir: '', followCwd: true, password: '', hasPassword: false, forget: false }
  }
  function editSession(s: SshSession): void {
    error.value = ''
    editing.value = draftOf(s)
  }
  /** A copy of a session (without its password: typed anew). */
  function copySession(s: SshSession): void {
    error.value = ''
    editing.value = { ...draftOf(s), id: '', name: `${s.name} (копия)`, hasPassword: false }
  }
  async function saveSession(): Promise<SshSession | undefined> {
    const d = editing.value
    if (!d) return undefined
    // the password: a new one typed — it; «forget» — none; nothing typed — the kept one stays
    const password = d.password ? d.password : d.forget ? '' : undefined
    try {
      const saved = await window.qa.ssh('saveSession', { id: d.id, name: d.name, folder: d.folder, host: d.host, port: Number(d.port), user: d.user, startDir: d.startDir, followCwd: d.followCwd, password })
      editing.value = undefined
      return saved
    } catch (e) {
      error.value = remoteError(e)
      return undefined
    }
  }
  async function deleteSession(s: SshSession): Promise<void> {
    if (!confirm(`Удалить сессию «${s.name}»? Открытые вкладки останутся до закрытия.`)) return
    await window.qa.ssh('deleteSession', s.id)
  }
  return { editing, error, addSession, editSession, copySession, saveSession, deleteSession }
}
export type SessionEditor = ReturnType<typeof useSessionEditor>
