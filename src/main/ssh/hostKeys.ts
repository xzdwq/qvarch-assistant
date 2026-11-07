import { createHash, createHmac } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import { hostKeyVerdict, keysOf, keyTypeOfBlob, knownHostLine, type HostKeyVerdict } from '../../shared/ssh/knownHosts'

/** OpenSSH's own file: a server trusted here is trusted by `ssh` in a console too, and the other way round. */
const KNOWN_HOSTS = join(homedir(), '.ssh', 'known_hosts')

const hmac = (salt: string, data: string) => createHmac('sha1', Buffer.from(salt, 'base64')).update(data).digest('base64')
/** A key's fingerprint as OpenSSH shows it: SHA256:base64 without the padding. */
export const fingerprint = (blob: Buffer) => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`

/** Asking the person about a server's key: what each verdict says and offers (a known key is never asked about). */
const ASK: Record<Exclude<HostKeyVerdict, 'known'>, (host: string, fp: string) => Electron.MessageBoxOptions> = {
  unknown: (host, fp) => ({
    type: 'question',
    title: 'Новый сервер',
    message: `Подключение к ${host} впервые`,
    detail: `Отпечаток ключа сервера:\n${fp}\n\nСверьте его с владельцем сервера, если сомневаетесь.`,
    buttons: ['Доверять и запомнить', 'Только сейчас', 'Отмена'],
    defaultId: 0,
    cancelId: 2,
  }),
  changed: (host, fp) => ({
    type: 'warning',
    title: 'Ключ сервера изменился',
    message: `Ключ ${host} не совпадает с запомненным`,
    detail: `Так бывает после переустановки сервера — или при подмене соединения.\nНовый отпечаток:\n${fp}\n\nПодключаться, только если вы знаете, почему ключ изменился.`,
    buttons: ['Отмена', 'Подключиться один раз', 'Заменить ключ'],
    defaultId: 0,
    cancelId: 0,
  }),
  revoked: (host, fp) => ({
    type: 'error',
    title: 'Ключ отозван',
    message: `Ключ ${host} отозван в known_hosts`,
    detail: fp,
    buttons: ['Закрыть'],
    defaultId: 0,
    cancelId: 0,
  }),
}
/** What a button means for each question: connect, and keep the key. */
const ANSWERS: Record<Exclude<HostKeyVerdict, 'known'>, Array<{ go: boolean; keep: boolean }>> = {
  unknown: [
    { go: true, keep: true },
    { go: true, keep: false },
    { go: false, keep: false },
  ],
  changed: [
    { go: false, keep: false },
    { go: true, keep: false },
    { go: true, keep: true },
  ],
  revoked: [{ go: false, keep: false }],
}

/**
 * A server's key checked against known_hosts: known — on; otherwise the person decides (in a dialog over `win`). A key
 * trusted for good goes into the file (a changed one — added after the old: OpenSSH takes the first match, so the old
 * line is left for the person to remove; the app trusts the new one by its exact key).
 */
export async function checkHostKey(host: string, port: number, blob: Buffer, win: BrowserWindow | undefined): Promise<boolean> {
  const keyType = keyTypeOfBlob(blob)
  const key = blob.toString('base64')
  let text = ''
  try {
    text = existsSync(KNOWN_HOSTS) ? readFileSync(KNOWN_HOSTS, 'utf8') : ''
  } catch {
    // not readable: every server is new
  }
  const verdict = hostKeyVerdict(keysOf(text, host, port, hmac), keyType, key)
  if (verdict === 'known') return true
  const opts = ASK[verdict](port === 22 ? host : `${host}:${port}`, fingerprint(blob))
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  const a = ANSWERS[verdict][r.response] ?? { go: false, keep: false }
  if (a.keep) remember(host, port, keyType, key)
  return a.go
}

function remember(host: string, port: number, keyType: string, key: string): void {
  try {
    mkdirSync(dirname(KNOWN_HOSTS), { recursive: true })
    const text = existsSync(KNOWN_HOSTS) ? readFileSync(KNOWN_HOSTS, 'utf8') : ''
    appendFileSync(KNOWN_HOSTS, `${text && !text.endsWith('\n') ? '\n' : ''}${knownHostLine(host, port, keyType, key)}\n`)
  } catch {
    // not writable: trusted for this connection only
  }
}
