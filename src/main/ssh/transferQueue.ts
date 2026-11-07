import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { baseRemote, joinRemote, localSafeName } from '../../shared/ssh/remotePath'
import { kindOfMode } from '../../shared/ssh/remoteFiles'
import { partName, transfersToStart, trimEnded, type Transfer, type TransferDir } from '../../shared/ssh/transfers'
import { makeDirs, readDir, renameOver, sftpError, statOf } from './sftpService'
import type { SshConnections } from './sshConnections'

/** Progress goes to the window at most this often. */
const TELL_MS = 200

/** What a transfer does once it arrived (the file opened by Windows' program for it). */
type After = (t: Transfer) => void

/**
 * The transfers between the PC and the servers: folders unfolded into files, a few at a time, each over an SFTP
 * channel of its own (cancel = that channel closed); a file is written as name.part and renamed when whole.
 */
export class TransferQueue {
  private list: Transfer[] = []
  private readonly channels = new Map<string, SFTPWrapper>()
  private readonly after = new Map<string, After>()
  private tellTimer?: NodeJS.Timeout

  constructor(
    private readonly conns: SshConnections,
    private readonly tell: (list: Transfer[]) => void,
  ) {}

  transfers(): Transfer[] {
    return this.list
  }

  /** Local files and folders into a server's folder. */
  async upload(id: string, localPaths: string[], remoteDir: string): Promise<void> {
    const sftp = await this.conns.sftp(id)
    for (const p of localPaths) {
      if (!existsSync(p)) continue
      if (statSync(p).isDirectory()) await this.uploadDir(id, sftp, p, joinRemote(remoteDir, basename(p)))
      else this.add(id, 'up', p, joinRemote(remoteDir, basename(p)), statSync(p).size)
    }
    this.pump()
  }
  private async uploadDir(id: string, sftp: SFTPWrapper, local: string, remote: string): Promise<void> {
    await makeDirs(sftp, remote)
    for (const d of readdirSync(local, { withFileTypes: true })) {
      const from = join(local, d.name)
      if (d.isDirectory()) await this.uploadDir(id, sftp, from, joinRemote(remote, d.name))
      else if (d.isFile()) this.add(id, 'up', from, joinRemote(remote, d.name), statSync(from).size)
    }
  }

  /** A server's files and folders into a local folder (`after` — done with each file once it arrived). */
  async download(id: string, remotePaths: string[], localDir: string, after?: After): Promise<void> {
    const sftp = await this.conns.sftp(id)
    for (const p of remotePaths) {
      let st
      try {
        st = await statOf(sftp, p)
      } catch (e) {
        throw sftpError(e, p)
      }
      const to = join(localDir, localSafeName(baseRemote(p)))
      if (kindOfMode(st.mode) === 'dir') await this.downloadDir(id, sftp, p, to)
      else this.add(id, 'down', p, to, st.size, after)
    }
    this.pump()
  }
  /** One server file to an exact local path (what is there is replaced once the file is whole). */
  async downloadAs(id: string, remote: string, to: string): Promise<void> {
    const sftp = await this.conns.sftp(id)
    const st = await statOf(sftp, remote).catch((e: unknown) => Promise.reject(sftpError(e, remote)))
    this.add(id, 'down', remote, to, st.size)
    this.pump()
  }
  private async downloadDir(id: string, sftp: SFTPWrapper, remote: string, local: string): Promise<void> {
    mkdirSync(local, { recursive: true })
    for (const r of await readDir(sftp, remote)) {
      if (r.filename === '.' || r.filename === '..') continue
      const from = joinRemote(remote, r.filename)
      const kind = kindOfMode(r.attrs.mode)
      if (kind === 'dir') await this.downloadDir(id, sftp, from, join(local, localSafeName(r.filename)))
      else if (kind === 'file') this.add(id, 'down', from, join(local, localSafeName(r.filename)), r.attrs.size)
    }
  }

  private add(sessionId: string, dir: TransferDir, from: string, to: string, size: number, after?: After): void {
    const t: Transfer = { id: randomUUID(), sessionId, dir, from, to, name: dir === 'up' ? basename(from) : baseRemote(from), size, done: 0, state: 'queued' }
    this.list = trimEnded([...this.list, t])
    if (after) this.after.set(t.id, after)
    this.changed()
  }

  /** As many queued transfers started as there are free places. */
  private pump(): void {
    for (const t of transfersToStart(this.list)) void this.run(t)
  }
  private async run(t: Transfer): Promise<void> {
    t.state = 'running'
    t.startedAt = Date.now()
    this.changed()
    const release = this.conns.hold(t.sessionId)
    try {
      const sftp = await this.conns.ownSftp(t.sessionId)
      this.channels.set(t.id, sftp)
      // (cancelled while its channel was being opened)
      if (t.state !== 'running') throw new Error('cancelled')
      await (t.dir === 'up' ? this.put(sftp, t) : this.get(sftp, t))
      t.state = 'done'
      t.done = t.size
    } catch (e) {
      // (cancelled: its channel was closed — that is the error it ends with)
      if (t.state === 'running') {
        t.state = 'failed'
        t.error = e instanceof Error ? e.message : String(e)
      }
      void this.dropPart(t)
    } finally {
      t.endedAt = Date.now()
      this.endChannel(t.id)
      release()
      this.changed()
      const after = this.after.get(t.id)
      this.after.delete(t.id)
      if (after && t.state === 'done') after(t)
      this.pump()
    }
  }
  /** A transfer that did not arrive leaves no half file behind (its .part removed where it was being written). */
  private async dropPart(t: Transfer): Promise<void> {
    const part = partName(t.to)
    try {
      if (t.dir === 'down') {
        if (existsSync(part)) unlinkSync(part)
        return
      }
      const sftp = await this.conns.sftp(t.sessionId)
      await new Promise<void>((ok) => sftp.unlink(part, () => ok()))
    } catch {
      // the connection is gone: the .part stays (a next transfer of it replaces it)
    }
  }
  private step = (t: Transfer) => (done: number) => {
    t.done = done
    this.changed()
  }
  private put(sftp: SFTPWrapper, t: Transfer): Promise<void> {
    const part = partName(t.to)
    return new Promise<void>((ok, fail) => sftp.fastPut(t.from, part, { step: (done) => this.step(t)(done) }, (e) => (e ? fail(sftpError(e, t.to)) : ok()))).then(() => renameOver(sftp, part, t.to))
  }
  private get(sftp: SFTPWrapper, t: Transfer): Promise<void> {
    const part = partName(t.to)
    mkdirSync(dirname(t.to), { recursive: true })
    return new Promise<void>((ok, fail) => sftp.fastGet(t.from, part, { step: (done) => this.step(t)(done) }, (e) => (e ? fail(sftpError(e, t.from)) : ok()))).then(() => {
      if (existsSync(t.to)) unlinkSync(t.to)
      renameSync(part, t.to)
    })
  }

  /** A transfer stopped (none — all going and waiting): a waiting one never starts, a going one's channel is closed. */
  cancel(transferId?: string): void {
    for (const t of this.list) {
      if ((transferId && t.id !== transferId) || (t.state !== 'queued' && t.state !== 'running')) continue
      t.state = 'cancelled'
      t.endedAt = Date.now()
      this.endChannel(t.id)
    }
    this.changed()
  }
  clearEnded(): void {
    this.list = this.list.filter((t) => t.state === 'queued' || t.state === 'running')
    this.changed()
  }
  private endChannel(id: string): void {
    const ch = this.channels.get(id)
    this.channels.delete(id)
    try {
      ch?.end()
    } catch {
      // gone already
    }
  }
  private changed(): void {
    this.tellTimer ??= setTimeout(() => {
      this.tellTimer = undefined
      this.tell(this.list)
    }, TELL_MS)
  }
}
