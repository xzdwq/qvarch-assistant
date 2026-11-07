import { reactive } from 'vue'
import { runApi } from './runApi'

/** At most this much of a run's live output is kept for its block (the newest part). */
const LIVE_MAX = 64 * 1024

/** The output of the shell runs going on, by block (note#key) — what the block shows while it runs. */
const live = reactive(new Map<string, string>())
/** A run's process id (its slot) → the block it shows in. */
const bySlot = new Map<string, string>()
let listening = false
const blockKey = (notePath: string, key: string) => `${notePath}#${key}`

function listen(): void {
  if (listening) return
  listening = true
  runApi().onShellOut((runId, _stream, chunk) => {
    const k = bySlot.get(runId)
    if (!k) return
    const t = (live.get(k) ?? '') + chunk
    live.set(k, t.length > LIVE_MAX ? t.slice(-LIVE_MAX) : t)
  })
}
/** A run starts: its output goes to its block (what the block showed before — gone). */
export function beginLive(slot: string, notePath: string, key: string): void {
  listen()
  bySlot.set(slot, blockKey(notePath, key))
  live.set(blockKey(notePath, key), '')
}
/** The run ended: its block shows its value from now on. */
export function endLive(slot: string): void {
  const k = bySlot.get(slot)
  bySlot.delete(slot)
  if (k) live.delete(k)
}
/** What a block's run has printed so far (none — not running). */
export const liveText = (notePath: string, key: string): string | undefined => live.get(blockKey(notePath, key))
