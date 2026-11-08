import { reactive } from 'vue'

/**
 * The runs waiting for a person: a block whose program asked something and waits for the answer (a terminal's sudo
 * password). The block shows it, the AI's tools and the harness's checks learn it at once — never wait out a run
 * that only a person can move on; the journal notes the run waited.
 */
export interface RunWait {
  notePath: string
  /** The block's run key. */
  key: string
  /** What it asked (the terminal's last line). */
  prompt: string
  since: number
}

const waits = reactive(new Map<string, RunWait>())
/** The runs that waited at some point (the journal asks once, at their end). */
const waited = new Set<string>()
const listeners = new Set<(w: RunWait) => void>()
const idOf = (notePath: string, key: string) => `${notePath}#${key}`

/** A block's run waits for input (`prompt`), or goes on again (none). */
export function setRunWaiting(notePath: string, key: string, prompt: string | undefined): void {
  const id = idOf(notePath, key)
  if (prompt === undefined) return void waits.delete(id)
  const w: RunWait = { notePath, key, prompt, since: Date.now() }
  waits.set(id, w)
  waited.add(id)
  for (const fn of listeners) fn(w)
}
/** What a block's run waits for now (none — it does not). */
export const runWaitOf = (notePath: string, key: string): RunWait | undefined => waits.get(idOf(notePath, key))
/** The runs of a note waiting now. */
export const runWaitsIn = (notePath: string): RunWait[] => [...waits.values()].filter((w) => w.notePath === notePath)
/** Whether a block's run waited since this was last asked (asked at its start and at its end). */
export function takeRunWaited(notePath: string, key: string): boolean {
  return waited.delete(idOf(notePath, key))
}

/**
 * The first wait of a note's runs from now (or one going on already) — `keys` given: of those blocks only. `cancel`
 * stops listening (the run ended first).
 */
export function whenRunWaits(notePath: string, keys?: ReadonlySet<string>): { wait: Promise<RunWait>; cancel: () => void } {
  const mine = (w: RunWait) => w.notePath === notePath && (!keys || keys.has(w.key))
  let fn: ((w: RunWait) => void) | undefined
  const wait = new Promise<RunWait>((resolve) => {
    const now = [...waits.values()].find(mine)
    if (now) return resolve(now)
    fn = (w) => mine(w) && resolve(w)
    listeners.add(fn)
  })
  return { wait, cancel: () => void (fn && listeners.delete(fn)) }
}
