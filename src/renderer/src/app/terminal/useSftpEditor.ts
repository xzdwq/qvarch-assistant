import { computed, ref } from 'vue'
import { remoteError } from '@shared/remoteError'
import { SSH_REMOTE_CHANGED } from '@shared/ssh/api'
import { editorLang } from '@shared/ssh/remoteEdit'
import type { RemoteEntry } from '@shared/ssh/remoteFiles'

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
  /** The last thing done, said for a moment (saved, the backup's name). */
  note: string
}

/**
 * The explorer's text editor: a server's file (config, yaml, a log) opened by a double click, saved back in place
 * (a change on the server meanwhile — asked first), a copy saved to this PC, a backup made next to it on the server.
 */
export function useSftpEditor() {
  const file = ref<EditedFile>()
  const dirty = computed(() => !!file.value && file.value.text !== file.value.saved)
  let noteTimer: ReturnType<typeof setTimeout> | undefined
  const say = (f: EditedFile, note: string) => {
    f.note = note
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => (f.note = ''), 4000)
  }

  /** A file opened for editing; not text (or too big) — false with nothing opened (the caller opens it another way). */
  async function open(sessionId: string, e: RemoteEntry): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const r = await window.qa.ssh('readText', sessionId, e.path)
      file.value = { sessionId, path: e.path, name: e.name, lang: editorLang(e.name), text: r.text, saved: r.text, mtime: r.mtime, busy: false, error: '', conflict: false, note: '' }
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: remoteError(err) }
    }
  }
  /** Saved back to the server (`force` — over a change made there meanwhile). */
  async function save(force = false): Promise<void> {
    const f = file.value
    if (!f || f.busy) return
    f.busy = true
    f.error = ''
    try {
      const text = f.text
      f.mtime = await window.qa.ssh('writeText', f.sessionId, f.path, text, f.mtime, force)
      f.saved = text
      f.conflict = false
      say(f, 'Сохранено на сервере')
    } catch (err) {
      const msg = remoteError(err)
      f.conflict = msg.includes(SSH_REMOTE_CHANGED)
      f.error = msg
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
  /** The file as it is on the server now copied next to it (name.backup-date). */
  async function backup(): Promise<void> {
    const f = file.value
    if (!f || f.busy) return
    f.busy = true
    f.error = ''
    try {
      const to = await window.qa.ssh('backup', f.sessionId, f.path)
      say(f, `Резервная копия: ${to.split('/').pop()}`)
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
