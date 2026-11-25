import { randomUUID } from 'node:crypto'
import type { SFTPWrapper, Stats } from 'ssh2'
import { backupPath, looksText, TEXT_EDIT_MAX, TEXT_SNIFF } from '../../shared/ssh/remoteEdit'
import { BACKUP_SCRIPT, EXIT_CHANGED, parseMtimeOutput, parseReadOutput, READ_SCRIPT, WRITE_SCRIPT } from '../../shared/ssh/sudo'
import { sizeText } from '../../shared/ssh/transfers'
import { SSH_REMOTE_CHANGED as REMOTE_CHANGED } from '../../shared/ssh/api'
import { sftpError, statOf } from './sftpService'
import { runError, type SudoRunner } from './sudoRunner'

/** A text file as the editor gets it: its text and what it was when read (to tell a change on the server at saving). */
export interface RemoteText {
  text: string
  mtime: number
  size: number
}
/** A save: the file's new time; `note` — its owner or rights could not be kept. */
export interface SavedText {
  mtime: number
  note?: string
}

const readBuf = (sftp: SFTPWrapper, path: string) => new Promise<Buffer>((ok, fail) => sftp.readFile(path, (e, b) => (e ? fail(e) : ok(b))))
const writeBuf = (sftp: SFTPWrapper, path: string, data: Buffer, mode?: number) =>
  new Promise<void>((ok, fail) => sftp.writeFile(path, data, mode === undefined ? {} : { mode }, (e) => (e ? fail(e) : ok())))
const chmod = (sftp: SFTPWrapper, path: string, mode: number) => new Promise<void>((ok) => sftp.chmod(path, mode & 0o7777, () => ok()))
const chown = (sftp: SFTPWrapper, path: string, uid: number, gid: number) => new Promise<void>((ok) => sftp.chown(path, uid, gid, () => ok()))
const unlink = (sftp: SFTPWrapper, path: string) => new Promise<void>((ok) => sftp.unlink(path, () => ok()))

/** The bytes read → the editor's text (too big, not text — the reason it is not opened). */
function textOf(buf: Buffer, size: number, mtime: number): RemoteText {
  if (size > TEXT_EDIT_MAX) throw new Error(`Файл слишком большой для редактора (${sizeText(size)}, можно до ${sizeText(TEXT_EDIT_MAX)})`)
  if (!looksText(buf.subarray(0, TEXT_SNIFF))) throw new Error('Это не текстовый файл')
  return { text: buf.toString('utf8'), mtime, size }
}

/** A file read for editing: not too big, text (UTF-8, no zero bytes) — else the reason it is not opened here. */
export async function readText(sftp: SFTPWrapper, path: string): Promise<RemoteText> {
  let st
  try {
    st = await statOf(sftp, path)
  } catch (e) {
    throw sftpError(e, path)
  }
  if (st.size > TEXT_EDIT_MAX) return textOf(Buffer.alloc(0), st.size, st.mtime)
  const buf = await readBuf(sftp, path).catch((e) => Promise.reject(sftpError(e, path)))
  return textOf(buf, st.size, st.mtime)
}

/** The owner and rights a write left as they were — put back where they differ (what could not be — said). */
async function keepAccess(sftp: SFTPWrapper, path: string, was: Stats): Promise<string | undefined> {
  let now = await statOf(sftp, path)
  // (chown first: it clears setuid / setgid, chmod then puts the rights back)
  if (now.uid !== was.uid || now.gid !== was.gid) await chown(sftp, path, was.uid, was.gid)
  if ((now.mode & 0o7777) !== (was.mode & 0o7777)) await chmod(sftp, path, was.mode)
  now = await statOf(sftp, path)
  const lost = [now.uid !== was.uid || now.gid !== was.gid ? 'владельца' : '', (now.mode & 0o7777) !== (was.mode & 0o7777) ? 'права' : ''].filter(Boolean)
  return lost.length ? `Сохранено, но сервер не дал вернуть ${lost.join(' и ')} файла` : undefined
}

/**
 * The text written back in place (the file itself is overwritten — its owner and rights stay; checked after, put back
 * if the server changed them). `mtime` — when it was read: the file changed on the server since — refused with
 * REMOTE_CHANGED (unless `force`).
 */
export async function writeText(sftp: SFTPWrapper, path: string, text: string, mtime: number | undefined, force: boolean): Promise<SavedText> {
  const was = await statOf(sftp, path).catch(() => undefined)
  if (was && mtime !== undefined && !force && was.mtime !== mtime) throw new Error(`${REMOTE_CHANGED} после открытия — сохранить всё равно?`)
  await writeBuf(sftp, path, Buffer.from(text, 'utf8')).catch((e) => Promise.reject(sftpError(e, path)))
  const note = was ? await keepAccess(sftp, path, was).catch(() => undefined) : undefined
  return { mtime: (await statOf(sftp, path)).mtime, note }
}

/** A copy of the file as it is on the server now, next to it (its rights too); the copy's path. */
export async function backup(sftp: SFTPWrapper, path: string, now = new Date()): Promise<string> {
  const to = backupPath(path, now)
  try {
    const st = await statOf(sftp, path)
    await writeBuf(sftp, to, await readBuf(sftp, path))
    await chmod(sftp, to, st.mode)
  } catch (e) {
    throw sftpError(e, to)
  }
  return to
}

// ---------- as root (sudo) ----------

/** A file read as root for editing. */
export async function readTextSudo(sudo: SudoRunner, id: string, path: string): Promise<RemoteText> {
  const r = await sudo.sudo(id, READ_SCRIPT, [path, String(TEXT_EDIT_MAX)])
  const got = r.code === 0 ? parseReadOutput(r.stdout) : undefined
  if (!got) throw runError(r, path)
  return textOf(Buffer.from(got.body), got.size, got.mtime)
}

/**
 * The text written as root, in place (`cat >` — the file keeps its owner and rights). It goes to the server first as
 * a temporary file of one's own (0600, in /tmp), removed after.
 */
export async function writeTextSudo(sudo: SudoRunner, sftp: SFTPWrapper, id: string, path: string, text: string, mtime: number | undefined, force: boolean): Promise<SavedText> {
  const tmp = `/tmp/.qvarch-edit-${randomUUID()}`
  await writeBuf(sftp, tmp, Buffer.from(text, 'utf8'), 0o600).catch((e) => Promise.reject(sftpError(e, tmp)))
  try {
    const r = await sudo.sudo(id, WRITE_SCRIPT, [tmp, path, mtime !== undefined && !force ? String(mtime) : ''])
    if (r.code === EXIT_CHANGED) throw new Error(`${REMOTE_CHANGED} после открытия — сохранить всё равно?`)
    if (r.code !== 0) throw runError(r, path)
    // written: its time from the script, else as SFTP sees it (the folder is readable even when the file is not)
    const at = parseMtimeOutput(r.stdout.toString('utf8')) ?? (await statOf(sftp, path).then((s) => s.mtime, () => undefined))
    if (at === undefined) throw new Error(`${path}: сохранено, но время изменения не прочитать — откройте файл заново`)
    return { mtime: at }
  } finally {
    await unlink(sftp, tmp)
  }
}

/** A copy made as root next to the file, with its owner, rights and times; the copy's path. */
export async function backupSudo(sudo: SudoRunner, id: string, path: string, now = new Date()): Promise<string> {
  const to = backupPath(path, now)
  const r = await sudo.sudo(id, BACKUP_SCRIPT, [path, to])
  if (r.code !== 0) throw runError(r, to)
  return to
}
