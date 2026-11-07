import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { SshApi, SshEmit } from '../../shared/ssh/api'
import type { RemoteListing } from '../../shared/ssh/remoteFiles'
import type { SshSession, SshSessionInput } from '../../shared/ssh/sessions'
import type { Transfer } from '../../shared/ssh/transfers'
import { SshSessionStore } from './sessionStore'
import { listDir, makeDir, realPath, removePath, renamePath } from './sftpService'
import { SshConnections } from './sshConnections'
import { TransferQueue } from './transferQueue'

/** Where «Открыть» brings a server's file (one folder of the app's own in %TEMP%; each file in a folder of its own). */
const OPEN_DIR = join(tmpdir(), 'qvarch-ssh')

/**
 * SSH for the window: the saved sessions, their connections (a terminal tab's shell comes from `connections`), the
 * file explorer's operations and the transfers. Answers the window's calls by name (SshApi).
 */
export class SshService implements SshApi {
  readonly store: SshSessionStore
  readonly connections: SshConnections
  private readonly queue: TransferQueue

  constructor(
    root: string,
    private readonly window: () => BrowserWindow | undefined,
    private readonly emit: SshEmit,
  ) {
    this.store = new SshSessionStore(root)
    this.connections = new SshConnections(this.store, window, (id, reason) => emit('closed', { id, reason }))
    this.queue = new TransferQueue(this.connections, (list) => emit('transfers', list))
  }

  // ---------- sessions ----------
  sessions(): SshSession[] {
    return this.store.sessions()
  }
  saveSession(s: SshSessionInput): SshSession {
    const saved = this.store.save(s)
    this.emit('sessions', this.store.sessions())
    return saved
  }
  deleteSession(id: string): void {
    this.store.remove(id)
    this.emit('sessions', this.store.sessions())
  }
  async connect(id: string, password?: string, save = false): Promise<void> {
    await this.connections.connect(id, password, save)
    // a password kept now: the window shows it as kept
    if (password !== undefined && save) this.emit('sessions', this.store.sessions())
  }

  // ---------- the file explorer ----------
  async startDir(id: string): Promise<string> {
    const own = this.store.get(id)?.startDir
    const sftp = await this.connections.sftp(id)
    return own || (await realPath(sftp, '.'))
  }
  async list(id: string, path: string): Promise<RemoteListing> {
    return listDir(await this.connections.sftp(id), path)
  }
  async mkdir(id: string, path: string): Promise<void> {
    await makeDir(await this.connections.sftp(id), path)
  }
  async rename(id: string, from: string, to: string): Promise<void> {
    await renamePath(await this.connections.sftp(id), from, to)
  }
  async remove(id: string, path: string): Promise<void> {
    await removePath(await this.connections.sftp(id), path)
  }
  upload(id: string, localPaths: string[], remoteDir: string): Promise<void> {
    return this.queue.upload(id, localPaths.filter((p) => typeof p === 'string' && p), remoteDir)
  }
  download(id: string, remotePaths: string[], localDir?: string): Promise<void> {
    return this.queue.download(id, remotePaths, localDir || app.getPath('downloads'))
  }
  open(id: string, remotePath: string): Promise<void> {
    return this.queue.download(id, [remotePath], join(OPEN_DIR, randomUUID()), (t) => void shell.openPath(t.to))
  }
  async pickFiles(): Promise<string[]> {
    const opts: Electron.OpenDialogOptions = { title: 'Загрузить на сервер', properties: ['openFile', 'multiSelections'] }
    const w = this.window()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  }
  async pickFolder(): Promise<string | undefined> {
    const opts: Electron.OpenDialogOptions = { title: 'Скачать в папку', properties: ['openDirectory', 'createDirectory'] }
    const w = this.window()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? undefined : r.filePaths[0]
  }

  // ---------- transfers ----------
  transfers(): Transfer[] {
    return this.queue.transfers()
  }
  cancel(transferId?: string): void {
    this.queue.cancel(transferId)
  }
  clearEnded(): void {
    this.queue.clearEnded()
  }

  /** On quit: transfers stopped, connections closed. */
  stop(): void {
    this.queue.cancel()
    this.connections.closeAll()
  }
}
