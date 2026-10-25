import { computed, shallowRef } from 'vue'
import type { TransportState } from '@shared/transport/constants'
import type { MethodName, TransportMethods } from '@shared/transport/protocol'

const state = shallowRef<TransportState>({ status: 'off', deviceId: '', hasCode: false })
let started = false

/** The transport server's connection state, shared by every component of a window (one subscription). */
export function useTransport() {
  if (!started) {
    started = true
    void window.qa.transportState().then((s) => (state.value = s))
    window.qa.onTransport((s) => (state.value = s))
  }
  return state
}

/** Connected to the server now (one for every context of the window). */
export const serverOnline = computed(() => useTransport().value.status === 'online')

/**
 * Now by the server's clock (epoch ms) — what the app stamps on shared things: the same for everyone, whatever the
 * computer's clock or time zone (never online yet — this computer's).
 */
export const serverNow = (): number => Date.now() + (useTransport().value.skew ?? 0)

/** A method of the server (the chat's, the shared spaces' and documents'), typed by the protocol. */
export const serverCall = <M extends Extract<MethodName, `${'chat' | 'space' | 'doc'}.${string}`>>(m: M, p: TransportMethods[M]['p']): Promise<TransportMethods[M]['r']> =>
  window.qa.serverCall(m, p) as Promise<TransportMethods[M]['r']>

/** The fingerprint as shown: groups of four. */
export const fingerprint = (id: string): string => id.slice(0, 16).replace(/(.{4})(?=.)/g, '$1 ')
