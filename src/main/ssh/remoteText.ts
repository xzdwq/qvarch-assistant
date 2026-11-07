import type { SFTPWrapper } from 'ssh2'
import { backupPath, looksText, TEXT_EDIT_MAX, TEXT_SNIFF } from '../../shared/ssh/remoteEdit'
import { sizeText } from '../../shared/ssh/transfers'
import { sftpError, statOf } from './sftpService'

/** A text file as the editor gets it: its text and what it was when read (to tell a change on the server at saving). */
export interface RemoteText {
  text: string
  mtime: number
  size: number
}
import { SSH_REMOTE_CHANGED as REMOTE_CHANGED } from '../../shared/ssh/api'

const readBuf = (sftp: SFTPWrapper, path: string) => new Promise<Buffer>((ok, fail) => sftp.readFile(path, (e, b) => (e ? fail(e) : ok(b))))
const writeBuf = (sftp: SFTPWrapper, path: string, data: Buffer) => new Promise<void>((ok, fail) => sftp.writeFile(path, data, {}, (e) => (e ? fail(e) : ok())))
const chmod = (sftp: SFTPWrapper, path: string, mode: number) => new Promise<void>((ok) => sftp.chmod(path, mode & 0o7777, () => ok()))

/** A file read for editing: not too big, text (UTF-8, no zero bytes) — else the reason it is not opened here. */
export async function readText(sftp: SFTPWrapper, path: string): Promise<RemoteText> {
  let st
  try {
    st = await statOf(sftp, path)
  } catch (e) {
    throw sftpError(e, path)
  }
  if (st.size > TEXT_EDIT_MAX) throw new Error(`Файл слишком большой для редактора (${sizeText(st.size)}, можно до ${sizeText(TEXT_EDIT_MAX)})`)
  const buf = await readBuf(sftp, path).catch((e) => Promise.reject(sftpError(e, path)))
  if (!looksText(buf.subarray(0, TEXT_SNIFF))) throw new Error('Это не текстовый файл')
  return { text: buf.toString('utf8'), mtime: st.mtime, size: st.size }
}

/**
 * The text written back in place (its owner and rights stay — the file itself is overwritten). `mtime` — when it was
 * read: the file changed on the server since — refused with REMOTE_CHANGED (unless `force`). Its new time.
 */
export async function writeText(sftp: SFTPWrapper, path: string, text: string, mtime: number | undefined, force: boolean): Promise<number> {
  if (mtime !== undefined && !force) {
    const now = await statOf(sftp, path).catch(() => undefined)
    if (now && now.mtime !== mtime) throw new Error(`${REMOTE_CHANGED} после открытия — сохранить всё равно?`)
  }
  await writeBuf(sftp, path, Buffer.from(text, 'utf8')).catch((e) => Promise.reject(sftpError(e, path)))
  return (await statOf(sftp, path)).mtime
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
