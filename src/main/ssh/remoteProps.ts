import type { SFTPWrapper } from 'ssh2'
import { kindOfMode, rightsOf } from '../../shared/ssh/remoteFiles'
import { baseRemote } from '../../shared/ssh/remotePath'
import { dirSummaryCommand, octalOf, parseDirSummary, parsePropsOutput, propsCommand, type DirSummary, type RemoteProps } from '../../shared/ssh/remoteProps'
import { shellQuote } from '../../shared/ssh/remoteShell'
import { lstatOf, sftpError, statOf } from './sftpService'
import type { SshConnections } from './sshConnections'

/** `stat` / `file` answer within this (a server without them — SFTP's part alone). */
const PROPS_MS = 8000
/** A folder is counted for at most this long. */
const COUNT_MS = 120_000
/** At most this much of a command's output is kept. */
const OUT_MAX = 64 * 1024

/** A command's output (stdout; errors — dropped), or undefined: it failed to start or ran out of time. */
async function execText(conns: SshConnections, id: string, command: string, ms: number): Promise<string | undefined> {
  let ch
  try {
    ch = await conns.exec(id, command)
  } catch {
    return undefined
  }
  return new Promise((done) => {
    let out = ''
    const timer = setTimeout(() => {
      ch.close()
      done(undefined)
    }, ms)
    ch.on('data', (d: Buffer) => out.length < OUT_MAX && (out += d.toString('utf8')))
    ch.stderr.on('data', () => undefined)
    ch.on('close', () => {
      clearTimeout(timer)
      done(out)
    })
  })
}

const readLink = (sftp: SFTPWrapper, path: string) => new Promise<string | undefined>((ok) => sftp.readlink(path, (e, t) => ok(e ? undefined : t)))

/** An entry's properties: SFTP's, with what `stat` / `file` on the server add where they are. */
export async function readProps(conns: SshConnections, sftp: SFTPWrapper, id: string, path: string): Promise<RemoteProps> {
  const st = await lstatOf(sftp, path).catch((e: unknown) => Promise.reject(sftpError(e, path)))
  const kind = kindOfMode(st.mode)
  const props: RemoteProps = { path, name: baseRemote(path) || path, kind, size: st.size, rights: rightsOf(st.mode), octal: octalOf(st.mode), uid: st.uid, gid: st.gid, mtime: st.mtime * 1000, atime: st.atime * 1000 }
  if (kind === 'link') {
    props.target = await readLink(sftp, path)
    props.targetKind = await statOf(sftp, path).then(
      (t) => kindOfMode(t.mode),
      () => undefined,
    )
  }
  const out = await execText(conns, id, propsCommand(shellQuote(path)), PROPS_MS)
  return out === undefined ? props : { ...props, ...parsePropsOutput(out) }
}

/** A folder's whole size, files and folders in it (the server counts: `du`, `find`). */
export async function countDir(conns: SshConnections, id: string, path: string): Promise<DirSummary> {
  const out = await execText(conns, id, dirSummaryCommand(shellQuote(path)), COUNT_MS)
  const r = out === undefined ? undefined : parseDirSummary(out)
  if (!r) throw new Error(out === undefined ? 'Сервер не успел посчитать размер папки' : 'Сервер не умеет считать размер папки (нужны du и find)')
  return r
}
