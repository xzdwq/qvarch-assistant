/**
 * What a shell block's run needs from the window: the person's say on a script not approved yet, and a password for
 * an SSH session that needs one. The notebook screen registers both; without it — refused / not connected.
 */

/** A script waiting for the person's say. */
export interface ShellApprovalAsk {
  notePath: string
  /** The block's name or its key (shown). */
  block: string
  lang: string
  script: string
  /** The SSH session it runs on (none — this PC). */
  ssh?: string
  /** Why it is asked: not approved yet (changed by someone else), or the block asks before every run. */
  why: 'new' | 'always'
}
export const SHELL_ANSWERS = ['always', 'once', 'no', 'timeout'] as const
export type ShellAnswer = (typeof SHELL_ANSWERS)[number]

/** How long a run waits for the person (a schedule in a hidden window waits for them to come). */
export const APPROVAL_WAIT_MS = 10 * 60_000

/** The window's way to ask: the question goes away when `signal` aborts (stopped, timed out). */
let approver: ((ask: ShellApprovalAsk, signal: AbortSignal) => Promise<Exclude<ShellAnswer, 'timeout'>>) | undefined
let connector: ((sessionId: string) => Promise<boolean>) | undefined
/** The questions waiting, by the run's slot (its «Стоп» takes the question back). */
const waiting = new Map<string, () => void>()

export const setShellApprover = (fn: typeof approver) => void (approver = fn)
export const setSshConnector = (fn: typeof connector) => void (connector = fn)

/**
 * The person's say on a script (no window to ask — no; no answer in time — timeout, the question taken back; the run
 * stopped meanwhile — no, the question taken back).
 */
export function askShellApproval(ask: ShellApprovalAsk, slot: string, waitMs = APPROVAL_WAIT_MS): Promise<ShellAnswer> {
  if (!approver) return Promise.resolve('no')
  waiting.get(slot)?.()
  const ctl = new AbortController()
  return new Promise<ShellAnswer>((done) => {
    let over = false
    const finish = (a: ShellAnswer) => {
      if (over) return
      over = true
      clearTimeout(timer)
      if (waiting.get(slot) === cancel) waiting.delete(slot)
      if (a === 'timeout' || a === 'no') ctl.abort()
      done(a)
    }
    const cancel = () => finish('no')
    waiting.set(slot, cancel)
    const timer = setTimeout(() => finish('timeout'), waitMs)
    void approver!(ask, ctl.signal).then(finish, () => finish('no'))
  })
}
/** A run stopped while its question waits: the answer is no, the question goes away. */
export const cancelShellApproval = (slot: string) => waiting.get(slot)?.()
/** An SSH session's connection made, a password asked for when needed (false — cancelled, or no window). */
export const connectSsh = (sessionId: string): Promise<boolean> => (connector ? connector(sessionId) : Promise.resolve(false))
