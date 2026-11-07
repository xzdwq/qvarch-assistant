import type { RemoteListing } from './remoteFiles'
import type { SshSession, SshSessionInput } from './sessions'
import type { Transfer } from './transfers'

/** What the window may ask of SSH (one IPC channel, the method's name first). */
export interface SshApi {
  sessions(): SshSession[]
  /** A session saved (a new one gets its id); a bad one — refused with the reason. */
  saveSession(s: SshSessionInput): SshSession
  deleteSession(id: string): void
  /**
   * The session's connection made (or the one there taken). No password kept, or it did not fit — refused with
   * SSH_NEEDS_PASSWORD: the window asks for one and calls again with it (`save` — kept for next time).
   */
  connect(id: string, password?: string, save?: boolean): Promise<void>
  /** The folder the explorer opens: the session's own, else the user's home on the server. */
  startDir(id: string): Promise<string>
  list(id: string, path: string): Promise<RemoteListing>
  mkdir(id: string, path: string): Promise<void>
  rename(id: string, from: string, to: string): Promise<void>
  /** A file, or a folder with everything in it. */
  remove(id: string, path: string): Promise<void>
  /** Local files and folders queued to go into a server's folder. */
  upload(id: string, localPaths: string[], remoteDir: string): Promise<void>
  /** A server's files and folders queued to come to a local folder (none — Загрузки). */
  download(id: string, remotePaths: string[], localDir?: string): Promise<void>
  /** A server's file brought to a temporary folder and opened by the program Windows has for it. */
  open(id: string, remotePath: string): Promise<void>
  /** Files to upload, picked in a dialog. */
  pickFiles(): Promise<string[]>
  /** A local folder, picked in a dialog. */
  pickFolder(): Promise<string | undefined>
  transfers(): Transfer[]
  /** A transfer stopped (none — every one going and waiting). */
  cancel(transferId?: string): void
  /** The ended transfers dropped from the list. */
  clearEnded(): void
}
export const SSH_METHODS: Array<keyof SshApi> = ['sessions', 'saveSession', 'deleteSession', 'connect', 'startDir', 'list', 'mkdir', 'rename', 'remove', 'upload', 'download', 'open', 'pickFiles', 'pickFolder', 'transfers', 'cancel', 'clearEnded']

/** The SSH side's news to the window. */
export interface SshEvents {
  sessions: SshSession[]
  transfers: Transfer[]
  /** A session's connection ended (the server, the network, closed by the app). */
  closed: { id: string; reason: string }
}
export type SshEventName = keyof SshEvents
export type SshEventArgs = { [K in SshEventName]: [type: K, payload: SshEvents[K]] }[SshEventName]
export type SshEmit = <K extends SshEventName>(type: K, payload: SshEvents[K]) => void

/** The start of the error a connection gives when it needs a password (none kept, or the kept one did not fit). */
export const SSH_NEEDS_PASSWORD = 'Нужен пароль'
export const needsPassword = (message: string) => message.includes(SSH_NEEDS_PASSWORD)
