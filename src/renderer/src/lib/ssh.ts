import { shallowRef } from 'vue'
import { needsPassword, needsSudo, type SshEventArgs } from '@shared/ssh/api'
import type { SshSession } from '@shared/ssh/sessions'
import type { Transfer } from '@shared/ssh/transfers'
import { remoteError } from '@shared/remoteError'

/** The saved SSH sessions and the transfers (their state comes from main), shared by the terminal's parts. */
const sessions = shallowRef<SshSession[]>([])
const transfers = shallowRef<Transfer[]>([])
/** Connections that ended (session id → why), until the next one is made. */
export const sshClosed = shallowRef<Record<string, string>>({})
let started = false
function start(): void {
  if (started) return
  started = true
  void window.qa.ssh('sessions').then((l) => (sessions.value = l))
  void window.qa.ssh('transfers').then((l) => (transfers.value = l))
  window.qa.onSsh((...e: SshEventArgs) => SSH_EVENTS[e[0]](e[1] as never))
}
/** What each of SSH's news does here. */
const SSH_EVENTS: { [K in SshEventArgs[0]]: (p: Extract<SshEventArgs, [K, unknown]>[1]) => void } = {
  sessions: (l) => (sessions.value = l),
  transfers: (l) => (transfers.value = [...l]),
  closed: ({ id, reason }) => (sshClosed.value = { ...sshClosed.value, [id]: reason }),
}
export function useSshSessions() {
  start()
  return sessions
}
export function useSshTransfers() {
  start()
  return transfers
}

/** The password asked for a session (the dialog shows it; answered — the promise settles). */
export const passwordAsk = shallowRef<{ session: SshSession; reason: string; answer: (a?: { password: string; save: boolean }) => void }>()

/** sudo's password asked for (the dialog shows it; answered — the promise settles; `useSsh` — the kept SSH one). */
export const sudoAsk = shallowRef<{ session?: SshSession; what: string; reason: string; answer: (a?: { password: string; useSsh: boolean }) => void }>()

/**
 * A call made as root: sudo's password asked for as long as the server wants one (none given, or it did not fit),
 * the call made again after each answer. undefined — the person cancelled; any other failure is thrown.
 * `what` — what is done, said in the dialog.
 */
export async function withSudo<T>(id: string, what: string, fn: () => Promise<T>): Promise<T | undefined> {
  start()
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      const msg = remoteError(e)
      if (!needsSudo(msg)) throw new Error(msg)
      const session = sessions.value.find((s) => s.id === id)
      const a = await new Promise<{ password: string; useSsh: boolean } | undefined>((answer) => (sudoAsk.value = { session, what, reason: msg, answer }))
      sudoAsk.value = undefined
      if (!a) return undefined
      await window.qa.ssh('sudoPassword', id, a.password, a.useSsh)
    }
  }
}

/**
 * A session's connection made, a password asked for as long as it is needed (none kept, or it did not fit): true —
 * connected; false — the person cancelled. Any other failure (no network, the server's key refused) is thrown.
 */
export async function ensureConnected(id: string): Promise<boolean> {
  start()
  let password: string | undefined
  let save = false
  for (;;) {
    try {
      await window.qa.ssh('connect', id, password, save)
      if (sshClosed.value[id]) {
        const { [id]: _gone, ...rest } = sshClosed.value
        sshClosed.value = rest
      }
      return true
    } catch (e) {
      const msg = remoteError(e)
      if (!needsPassword(msg)) throw new Error(msg)
      const session = sessions.value.find((s) => s.id === id)
      if (!session) throw new Error('Сессия не найдена')
      const a = await new Promise<{ password: string; save: boolean } | undefined>((answer) => (passwordAsk.value = { session, reason: password === undefined ? msg : 'Пароль не подошёл', answer }))
      passwordAsk.value = undefined
      if (!a) return false
      password = a.password
      save = a.save
    }
  }
}
