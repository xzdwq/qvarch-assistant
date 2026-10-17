import { reactive, ref, shallowRef } from 'vue'
import type { HttpDoc, HttpRunResult } from '@shared/http'

/**
 * The HTTP runs, kept apart from the section: a chain runs in the main process and goes on while other things
 * are open (another request, another section) — its steps land here; the section shows them when it is back.
 */
export const results = reactive(new Map<string, HttpRunResult>())
export interface ChainRun {
  runId: string
  folderId: string
  ids: string[]
  /** Steps done. */
  done: number
  running: boolean
  stopped?: string
}
export const chainRun = shallowRef<ChainRun>()
/** A request opened from its chain: the folder to go back to (kept while the section is away). */
export const backTo = ref<string>()
/** The latest step (the open section takes its variables into its collection). */
export const lastStep = shallowRef<{ id: string; out: HttpRunResult }>()
let started = false
function start(): void {
  if (started) return
  started = true
  window.qa.onHttpChain((runId, i, id, out) => {
    const c = chainRun.value
    if (!c || c.runId !== runId) return
    results.set(id, out)
    chainRun.value = { ...c, done: i + 1 }
    lastStep.value = { id, out }
  })
}
export async function startChain(folderId: string, ids: string[], doc: HttpDoc, stopOn: string): Promise<void> {
  start()
  if (chainRun.value?.running) return
  const runId = Math.random().toString(36).slice(2)
  for (const id of ids) results.delete(id)
  chainRun.value = { runId, folderId, ids, done: 0, running: true }
  let stopped: string | undefined
  try {
    stopped = (await window.qa.httpChain(ids, JSON.parse(JSON.stringify(doc)) as HttpDoc, stopOn, runId)).stopped
  } catch (e) {
    stopped = e instanceof Error ? e.message : String(e)
  }
  if (chainRun.value?.runId === runId) chainRun.value = { ...chainRun.value, running: false, stopped }
}
export function abortChain(): void {
  const c = chainRun.value
  if (c?.running) void window.qa.httpAbort(c.runId)
}
