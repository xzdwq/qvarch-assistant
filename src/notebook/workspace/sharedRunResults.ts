import { computed, watch } from 'vue'
import { retryDelay } from '@shared/transport/constants'
import { loadedRuns, onRunsChanged, saveRunsSoon } from '@nb/engine/runStore'
import { runEntries } from '@nb/engine/sharedRuns'
import { changesToSend, markOwn, receive, settle } from '@nb/engine/resultSync'
import { onServerEvents } from '@renderer/lib/serverEvents'
import { serverOnline, useTransport } from '@renderer/lib/transport'
import { docs } from './noteDocs'
import { readonlyPath, sharedDocOfPath, sharedInfo, sharedOfPath } from './sharedDocs'

/**
 * The run results of the shared notes: whoever runs a block (their connection, their database), everyone sees its
 * result. Ordered by the server alone (resultSync: its revisions and its clock): this device's results go a moment
 * after a run ends — each over the revision it was made over; the others' come when the server says one came. A note
 * coming into step (opened, online again, the app started) takes what came meanwhile first, then sends what it made
 * offline — what someone ran meanwhile wins over it. Each note's work goes one step after another; a failure — tried
 * again later and later.
 */
const SEND_MS = 1000
const me = computed(() => useTransport().value.deviceId)

/** Per note: the last change fetched (this run — a restart fetches all again: the marks tell what is known). */
const seqOf = new Map<string, number>()
/** Per note: its work in a row (a fetch and a send never cross), failures in a row, the next step waited for. */
const queue = new Map<string, Promise<void>>()
const fails = new Map<string, number>()
/** Per note: a send a moment after a run, a try again after a failure (apart: one never cancels the other). */
const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** The open notes of a document. */
const pathsOf = (doc: string) => [...docs.keys()].filter((p) => sharedDocOfPath(p) === doc)

/** A note's step after its last one; failed — the note brought into step again a while later. */
function inTurn(path: string, step: () => Promise<void>): Promise<void> {
  const next = (queue.get(path) ?? Promise.resolve()).then(step).then(
    () => void fails.delete(path),
    (e: Error) => {
      const n = (fails.get(path) ?? 0) + 1
      fails.set(path, n)
      window.qa.sharedLog(`results ${path}: ${e.message}`)
      later(retryTimers, path, () => bringIntoStep(path), retryDelay(n))
    },
  )
  queue.set(path, next)
  return next
}
function later(timers: Map<string, ReturnType<typeof setTimeout>>, path: string, fn: () => void, ms: number): void {
  clearTimeout(timers.get(path))
  timers.set(
    path,
    setTimeout(() => (timers.delete(path), fn()), ms),
  )
}

/** The others' results since the last fetched, into the note (the server's order decides). */
async function fetchInto(path: string): Promise<void> {
  const sh = sharedOfPath(path)
  if (!sh || !serverOnline.value) return
  const page = await window.qa.sharedResultsGet(sh.space, sh.doc, seqOf.get(path) ?? 0)
  const n = await loadedRuns(path)
  n.sync ??= {}
  let changed = false
  for (const [key, r] of Object.entries(page.entries)) changed = receive(n, n.sync, key, r, me.value) || changed
  seqOf.set(path, page.seq)
  if (changed) saveRunsSoon(path)
}
/** This device's results of the note: its new runs marked; online (one who may edit) — sent, the answer put in. */
async function sendFrom(path: string): Promise<void> {
  const sh = sharedOfPath(path)
  if (!sh) return
  const n = await loadedRuns(path)
  n.sync ??= {}
  const now = runEntries(n)
  let changed = markOwn(n, n.sync, now)
  const changes = changesToSend(n.sync, now)
  if (serverOnline.value && !readonlyPath(path) && Object.keys(changes).length) {
    // (plain data: the reactive results cannot cross to the main process)
    const reply = await window.qa.sharedResultsPut(sh.space, sh.doc, JSON.parse(JSON.stringify(changes)) as typeof changes)
    changed = settle(n, n.sync, reply, me.value) || changed
  }
  if (changed) saveRunsSoon(path)
}
/** The note in step: what came meanwhile taken first, then what this device made sent. */
const bringIntoStep = (path: string) => void inTurn(path, async () => {
  await fetchInto(path)
  await sendFrom(path)
})

let started = false
/** The results followed from the app's start. */
export function startSharedRunResults(): void {
  if (started) return
  started = true
  // a run ended (or a result came in): sent a moment after
  onRunsChanged((path) => sharedOfPath(path) && later(sendTimers, path, () => void inTurn(path, () => sendFrom(path)), SEND_MS))
  onServerEvents({
    'doc.results': (p) => {
      if (p.by !== me.value) for (const path of pathsOf(p.doc)) void inTurn(path, () => fetchInto(path))
    },
  })
  // a shared note open and in step with the server (opened, online again): brought into step
  watch(
    () => [...sharedInfo].filter(([, i]) => i.live).flatMap(([doc]) => pathsOf(doc)),
    (open, before) => open.filter((p) => !before?.includes(p)).forEach(bringIntoStep),
    { immediate: true },
  )
}
