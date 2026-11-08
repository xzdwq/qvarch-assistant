import { reactive } from 'vue'
import { runApi } from './runApi'
import { setRunWaiting } from './runWaits'

/** At most this much of a run's live output is kept for its block (the newest part). */
const LIVE_MAX = 64 * 1024

/** The output of the shell runs going on, by block (note#key) — what the block shows while it runs. */
const live = reactive(new Map<string, string>())
/** A run's process id (its slot) → the block it shows in. */
const bySlot = new Map<string, { notePath: string; key: string }>()
/** A run's process id → who takes its output as it comes (its value growing while it runs). */
const followers = new Map<string, (stream: 'out' | 'err', chunk: string) => void>()
let listening = false
const blockKey = (notePath: string, key: string) => `${notePath}#${key}`

function listen(): void {
  if (listening) return
  listening = true
  runApi().onShellOut((runId, stream, chunk) => {
    followers.get(runId)?.(stream, chunk)
    const b = bySlot.get(runId)
    if (!b) return
    const k = blockKey(b.notePath, b.key)
    const t = (live.get(k) ?? '') + chunk
    live.set(k, t.length > LIVE_MAX ? t.slice(-LIVE_MAX) : t)
  })
  // a terminal run asks the person (sudo's password) — or goes on: the block, the AI's tools, the harness learn it
  runApi().onShellWait((runId, prompt) => {
    const b = bySlot.get(runId)
    if (b) setRunWaiting(b.notePath, b.key, prompt || undefined)
  })
}
/** A run starts: its output goes to its block (what the block showed before — gone). */
export function beginLive(slot: string, notePath: string, key: string, follow?: (stream: 'out' | 'err', chunk: string) => void): void {
  listen()
  bySlot.set(slot, { notePath, key })
  if (follow) followers.set(slot, follow)
  live.set(blockKey(notePath, key), '')
}
/** The run ended: its block shows its value from now on (it waits for nothing any more). */
export function endLive(slot: string): void {
  const b = bySlot.get(slot)
  bySlot.delete(slot)
  followers.delete(slot)
  if (!b) return
  live.delete(blockKey(b.notePath, b.key))
  setRunWaiting(b.notePath, b.key, undefined)
}
/** The person's answer to the run going on in a block (a terminal run asks — sudo's password); none running — dropped. */
export function sendLiveInput(notePath: string, key: string, text: string): void {
  for (const [slot, b] of bySlot) if (b.notePath === notePath && b.key === key) runApi().runShellInput(slot, text)
}
/** What a block's run has printed so far (none — not running). */
export const liveText = (notePath: string, key: string): string | undefined => live.get(blockKey(notePath, key))
