import { shallowRef } from 'vue'
import { setShellApprover, setSshConnector, type ShellAnswer, type ShellApprovalAsk } from '@nb/engine/shellApproval'
import { ensureConnected } from './ssh'

/** A script waiting for the person's say, with its answer to give. */
export interface PendingApproval {
  ask: ShellApprovalAsk
  answer: (a: Exclude<ShellAnswer, 'timeout'>) => void
}
/** The scripts waiting, the first one shown (one dialog — they come one after another). */
export const pendingApprovals = shallowRef<PendingApproval[]>([])

/** The person answered the first one waiting. */
export function answerApproval(a: Exclude<ShellAnswer, 'timeout'>): void {
  const [first, ...rest] = pendingApprovals.value
  pendingApprovals.value = rest
  first?.answer(a)
}

let started = false
/**
 * The notebook's shell runs get the window's help: a script not approved yet is asked about in the dialog (whatever
 * section is open — a schedule or the AI may run it); an SSH session that needs a password asks for it.
 */
export function startShellApprovals(): void {
  if (started) return
  started = true
  setShellApprover(
    (ask, signal) =>
      new Promise((answer) => {
        const item: PendingApproval = { ask, answer: (a) => answer(a) }
        pendingApprovals.value = [...pendingApprovals.value, item]
        // stopped or timed out: the question goes away (an answer to it would reach nothing)
        signal.addEventListener('abort', () => (pendingApprovals.value = pendingApprovals.value.filter((x) => x !== item)), { once: true })
      }),
  )
  setSshConnector((id) => ensureConnected(id).catch(() => false))
}
