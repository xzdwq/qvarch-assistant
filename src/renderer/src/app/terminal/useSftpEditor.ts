import { computed, ref } from 'vue'
import { remoteError } from '@shared/remoteError'
import { noAccess, SSH_REMOTE_CHANGED } from '@shared/ssh/api'
import { editorLang } from '@shared/ssh/remoteEdit'
import type { RemoteEntry } from '@shared/ssh/remoteFiles'
import { withSudo } from '../../lib/ssh'

/** A server's text file open in the editor: what it holds now, what it was when read (or last saved). */
export interface EditedFile {
  sessionId: string
  path: string
  name: string
  lang: string
  text: string
  /** The text as on the server (read or saved): differs from `text` — unsaved changes. */
  saved: string
  mtime: number
  busy: boolean
  error: string
  /** A save refused: the file changed on the server since it was read — saving over it waits for a yes. */
  conflict: boolean
  /** A save refused: no right to write it — saving as root (sudo) is offered. */
  denied: boolean
  /** Read and saved as root (sudo). */
  sudo: boolean
  /** The last thing done, said for a moment (saved, the backup's name). */
  note: string
}

/** What opening gave: opened; the person cancelled sudo's password; or why it is not opened here. */
export type OpenResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; reason: string; denied: boolean }

/**
 * The explorer's text editor: a server's file (config, yaml, a log) opened by a double click, saved back in place —
 * its owner and rights kept (a change on the server meanwhile — asked first), a copy saved to this PC, a backup made
 * next to it on the server. A file one may not write (or read) — the same as root, sudo's password asked for.
 */
export function useSftpEditor() {
  const file = ref<EditedFile>()
  const dirty = computed(() => !!file.value && file.value.text !== file.value.saved)
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  const say = (f: EditedFile, note: string, ms = 4000) => {
    f.note = note
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => (f.note = ''), ms)
  }
  /** A call as the signed-in user, or as root (sudo's password asked for when needed; cancelled — undefined). */
  const call = <T>(sessionId: string, sudo: boolean, what: string, fn: () => Promise<T>) => (sudo ? withSudo(sessionId, what, fn) : fn())

  /** A file opened for editing (`sudo` — read as root); not text, too big, not allowed — why (the caller decides). */
  async function open(sessionId: string, e: RemoteEntry, sudo = false): Promise<OpenResult> {
    try {
      const r = await call(sessionId, sudo, `Открыть ${e.path}`, () => window.qa.ssh('readText', sessionId, e.path, sudo))
      if (!r) return { ok: false, cancelled: true }
      file.value = { sessionId, path: e.path, name: e.name, lang: editorLang(e.name), text: r.text, saved: r.text, mtime: r.mtime, busy: false, error: '', conflict: false, denied: false, sudo, note: '' }
      return { ok: true }
    } catch (err) {
      const reason = remoteError(err)
      return { ok: false, reason, denied: noAccess(reason) }
    }
  }
  /** Saved back to the server (`force` — over a change made there meanwhile; `asRoot` — from now on through sudo). */
  async function save(force = false, asRoot = false): Promise<void> {
    const f = file.value
    if (!f || f.busy) return
    const sudo = f.sudo || asRoot
    f.busy = true
    f.error = ''
    try {
      const text = f.text
      const r = await call(f.sessionId, sudo, `Сохранить ${f.path}`, () => window.qa.ssh('writeText', f.sessionId, f.path, text, f.mtime, force, sudo))
      if (!r) return
      f.mtime = r.mtime
      f.saved = text
      f.conflict = false
      f.denied = false
      f.sudo = sudo
      if (r.note) say(f, r.note, 10_000)
      else say(f, sudo ? 'Сохранено на сервере (sudo) — владелец и права прежние' : 'Сохранено на сервере')
    } catch (err) {
      const msg = remoteError(err)
      f.conflict = msg.includes(SSH_REMOTE_CHANGED)
      f.denied = !sudo && noAccess(msg)
      f.error = f.denied ? `${msg} — у вас нет права записи в этот файл` : msg
    } finally {
      f.busy = false
    }
  }
  /** The text as edited saved as a file on this PC. */
  async function saveAs(): Promise<void> {
    const f = file.value
    if (!f) return
    const to = await window.qa.ssh('saveLocal', f.name, f.text)
    if (to) say(f, `Копия сохранена: ${to}`)
  }
  /** The file as it is on the server now copied next to it (name.backup-date; as root when edited so). */
  async function backup(): Promise<void> {
    const f = file.value
    if (!f || f.busy) return
    f.busy = true
    f.error = ''
    try {
      const to = await call(f.sessionId, f.sudo, `Резервная копия ${f.path}`, () => window.qa.ssh('backup', f.sessionId, f.path, f.sudo))
      if (to) say(f, `Резервная копия: ${to.split('/').pop()}`)
    } catch (err) {
      f.error = remoteError(err)
    } finally {
      f.busy = false
    }
  }
  /** Closed (unsaved changes — asked first). */
  function close(): void {
    if (dirty.value && !confirm('Изменения не сохранены. Закрыть без сохранения?')) return
    file.value = undefined
  }
  return { file, dirty, open, save, saveAs, backup, close }
}
export type SftpEditor = ReturnType<typeof useSftpEditor>
