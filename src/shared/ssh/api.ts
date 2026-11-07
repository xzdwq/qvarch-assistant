import type { RemoteListing } from './remoteFiles'
import type { DirSummary, RemoteProps } from './remoteProps'
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
  /**
   * Entries downloaded where the person chooses: one file — a save dialog (its name may be changed), else — a folder
   * dialog. The dialog opens where the last download went. Cancelled — nothing.
   */
  downloadAsk(id: string, entries: Array<{ path: string; dir: boolean }>): Promise<void>
  /** A download's file shown in Windows' Explorer (still coming, failed — its folder). */
  reveal(transferId: string): void
  /** An entry's properties (the explorer's «Свойства»). */
  props(id: string, path: string): Promise<RemoteProps>
  /** A folder's whole size and what is in it (counted by the server; may take long). */
  countDir(id: string, path: string): Promise<DirSummary>
  /** A server's file brought to a temporary folder and opened by the program Windows has for it. */
  open(id: string, remotePath: string): Promise<void>
  /** A text file read for the editor (too big, not text — refused with the reason). */
  readText(id: string, path: string): Promise<{ text: string; mtime: number; size: number }>
  /** The editor's text saved in place; changed on the server since `mtime` — refused (unless `force`). Its new time. */
  writeText(id: string, path: string, text: string, mtime?: number, force?: boolean): Promise<number>
  /** A copy of the file as it is now, next to it: name.backup-YYYY-MM-DD_HH-MM-SS. Its path. */
  backup(id: string, path: string): Promise<string>
  /** The editor's text saved as a file on this PC (a dialog; cancelled — none). */
  saveLocal(name: string, text: string): Promise<string | undefined>
  /** Files to upload, picked in a dialog. */
  pickFiles(): Promise<string[]>
  /** A local folder, picked in a dialog (`title` — its head; none — «Скачать в папку»; `start` — where it opens). */
  pickFolder(title?: string, start?: string): Promise<string | undefined>
  transfers(): Transfer[]
  /** A transfer stopped (none — every one going and waiting). */
  cancel(transferId?: string): void
  /** The ended transfers dropped from the list. */
  clearEnded(): void
}
export const SSH_METHODS: Array<keyof SshApi> = ['sessions', 'saveSession', 'deleteSession', 'connect', 'startDir', 'list', 'mkdir', 'rename', 'remove', 'upload', 'download', 'downloadAsk', 'reveal', 'props', 'countDir', 'open', 'readText', 'writeText', 'backup', 'saveLocal', 'pickFiles', 'pickFolder', 'transfers', 'cancel', 'clearEnded']

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
/** The start of the error a save gives when the file changed on the server after it was opened. */
export const SSH_REMOTE_CHANGED = 'Файл на сервере изменился'
