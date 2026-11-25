import type { AccessChange } from './remoteAccess'
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
  /** A text file read for the editor (too big, not text — refused with the reason); `sudo` — read as root. */
  readText(id: string, path: string, sudo?: boolean): Promise<{ text: string; mtime: number; size: number }>
  /**
   * The editor's text saved in place — its owner and rights stay (`note` — they could not be kept); changed on the
   * server since `mtime` — refused (unless `force`); `sudo` — written as root. Its new time.
   */
  writeText(id: string, path: string, text: string, mtime?: number, force?: boolean, sudo?: boolean): Promise<{ mtime: number; note?: string }>
  /** A copy of the file as it is now, next to it: name.backup-YYYY-MM-DD_HH-MM-SS (`sudo` — as root, owner kept). Its path. */
  backup(id: string, path: string, sudo?: boolean): Promise<string>
  /** An entry's rights / owner / group changed (AccessChange; `sudo` — as root). */
  setAccess(id: string, path: string, change: AccessChange, sudo?: boolean): Promise<void>
  /**
   * sudo's password for the session, kept in memory only (dropped when the connection breaks, the app closes or it does
   * not fit; `useSsh` — the kept SSH password);
   * asked for after a call refused with SSH_NEEDS_SUDO, which is then called again.
   */
  sudoPassword(id: string, password?: string, useSsh?: boolean): void
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
export const SSH_METHODS: Array<keyof SshApi> = ['sessions', 'saveSession', 'deleteSession', 'connect', 'startDir', 'list', 'mkdir', 'rename', 'remove', 'upload', 'download', 'downloadAsk', 'reveal', 'props', 'countDir', 'open', 'readText', 'writeText', 'backup', 'setAccess', 'sudoPassword', 'saveLocal', 'pickFiles', 'pickFolder', 'transfers', 'cancel', 'clearEnded']

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
/** The end of the error SFTP gives when the signed-in user may not do it (the window offers sudo). */
export const SSH_NO_ACCESS = 'нет доступа'
export const noAccess = (message: string) => message.endsWith(`: ${SSH_NO_ACCESS}`)
/** The start of the error a sudo call gives when it needs sudo's password (none given, or it did not fit). */
export const SSH_NEEDS_SUDO = 'Нужен пароль sudo'
export const needsSudo = (message: string) => message.includes(SSH_NEEDS_SUDO)
