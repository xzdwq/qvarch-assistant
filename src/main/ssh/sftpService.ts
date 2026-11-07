import type { SFTPWrapper, Stats } from 'ssh2'
import { joinRemote, normRemote, parentRemote } from '../../shared/ssh/remotePath'
import { kindOfMode, LISTING_MAX, rightsOf, sortEntries, type RemoteEntry, type RemoteListing } from '../../shared/ssh/remoteFiles'

/** SFTP's status codes in plain words (the rest — as the server says it). */
const SFTP_ERRORS: Record<number, string> = {
  2: 'нет такого файла или папки',
  3: 'нет доступа',
  4: 'сервер не смог выполнить операцию',
}
export function sftpError(e: unknown, what: string): Error {
  const err = e as Error & { code?: number }
  return new Error(`${what}: ${(typeof err.code === 'number' && SFTP_ERRORS[err.code]) || err.message}`)
}

const call = <T>(fn: (cb: (e: Error | null | undefined, v: T) => void) => void) => new Promise<T>((ok, fail) => fn((e, v) => (e ? fail(e) : ok(v))))
const callVoid = (fn: (cb: (e: Error | null | undefined) => void) => void) => new Promise<void>((ok, fail) => fn((e) => (e ? fail(e) : ok())))

export const statOf = (sftp: SFTPWrapper, path: string) => call<Stats>((cb) => sftp.stat(path, cb))
export const lstatOf = (sftp: SFTPWrapper, path: string) => call<Stats>((cb) => sftp.lstat(path, cb))
export const readDir = (sftp: SFTPWrapper, path: string) => call<Array<{ filename: string; attrs: Stats }>>((cb) => sftp.readdir(path, cb))
export const realPath = (sftp: SFTPWrapper, path: string) => call<string>((cb) => sftp.realpath(path, cb))

/** A folder as the explorer shows it: links to folders marked (they open as folders), at most LISTING_MAX entries. */
export async function listDir(sftp: SFTPWrapper, path0: string): Promise<RemoteListing> {
  const path = normRemote(path0)
  let raw: Array<{ filename: string; attrs: Stats }>
  try {
    raw = await readDir(sftp, path)
  } catch (e) {
    throw sftpError(e, path)
  }
  const entries: RemoteEntry[] = raw
    .filter((r) => r.filename !== '.' && r.filename !== '..')
    .map((r) => ({ name: r.filename, path: joinRemote(path, r.filename), kind: kindOfMode(r.attrs.mode), size: r.attrs.size, mtime: r.attrs.mtime * 1000, rights: rightsOf(r.attrs.mode) }))
  // a link: where it leads (a broken one stays a link)
  await Promise.all(
    entries
      .filter((e) => e.kind === 'link')
      .map(async (e) => {
        try {
          e.toDir = kindOfMode((await statOf(sftp, e.path)).mode) === 'dir'
        } catch {
          // broken
        }
      }),
  )
  const sorted = sortEntries(entries)
  return sorted.length > LISTING_MAX ? { path, entries: sorted.slice(0, LISTING_MAX), cut: sorted.length - LISTING_MAX } : { path, entries: sorted }
}

export async function makeDir(sftp: SFTPWrapper, path: string): Promise<void> {
  try {
    await callVoid((cb) => sftp.mkdir(path, cb))
  } catch (e) {
    throw sftpError(e, path)
  }
}
/** A folder and the ones above it, as many as are missing (as `mkdir -p`). */
export async function makeDirs(sftp: SFTPWrapper, path: string): Promise<void> {
  const target = normRemote(path)
  try {
    if (kindOfMode((await statOf(sftp, target)).mode) === 'dir') return
  } catch {
    // not there: made below
  }
  const parent = parentRemote(target)
  if (parent !== target) await makeDirs(sftp, parent)
  await makeDir(sftp, target).catch(async (e) => {
    // made meanwhile by a parallel transfer
    if (kindOfMode((await statOf(sftp, target).catch(() => ({ mode: 0 }) as Stats)).mode) !== 'dir') throw e
  })
}

/** A rename that replaces what is at the target (OpenSSH's posix-rename when there, else remove then rename). */
export async function renameOver(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  const ext = (sftp as unknown as { ext_openssh_rename?: (a: string, b: string, cb: (e?: Error | null) => void) => void }).ext_openssh_rename
  try {
    if (ext) return await callVoid((cb) => ext.call(sftp, from, to, cb))
  } catch {
    // the server has no such extension after all: below
  }
  await callVoid((cb) => sftp.unlink(to, cb)).catch(() => undefined)
  await callVoid((cb) => sftp.rename(from, to, cb))
}

export async function renamePath(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  try {
    await callVoid((cb) => sftp.rename(from, to, cb))
  } catch (e) {
    throw sftpError(e, from)
  }
}

/** A file, or a folder with everything in it (a link — itself, never what it leads to). The root is never removed. */
export async function removePath(sftp: SFTPWrapper, path0: string): Promise<void> {
  const path = normRemote(path0)
  if (parentRemote(path) === path) throw new Error('Корень удалить нельзя')
  try {
    const st = await lstatOf(sftp, path)
    if (kindOfMode(st.mode) === 'dir') {
      for (const r of await readDir(sftp, path)) if (r.filename !== '.' && r.filename !== '..') await removePath(sftp, joinRemote(path, r.filename))
      await callVoid((cb) => sftp.rmdir(path, cb))
    } else await callVoid((cb) => sftp.unlink(path, cb))
  } catch (e) {
    throw e instanceof Error && e.message.startsWith(path) ? e : sftpError(e, path)
  }
}
