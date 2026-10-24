import { computed, watch } from 'vue'
import { loadedNoteRun, noteRun, onRunsChanged, saveRunsSoon } from '@nb/engine/runStore'
import { applyEntry, entriesToSend, runEntries } from '@nb/engine/sharedRuns'
import { useTransport } from '@renderer/lib/transport'
import { docs } from './noteDocs'
import { readonlyPath, sharedDocOfPath, sharedInfo, sharedOfPath } from './sharedDocs'

/**
 * The run results of the shared notes: whoever runs a block (their connection, their database), everyone sees its
 * result — this device's results sent a moment after a run ends, the others' fetched when the server tells one came
 * (and when the note is opened). Someone else's result shows who ran it; one's own newer run is never replaced.
 */
const SEND_MS = 1000
const transport = useTransport()
const online = computed(() => transport.value.status === 'online')
const me = computed(() => transport.value.deviceId)

/** Per document: what was sent of this device's results (each entry's JSON), the last change fetched. */
const sent = new Map<string, Map<string, string>>()
const seqOf = new Map<string, number>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const sentOf = (doc: string) => sent.get(doc) ?? sent.set(doc, new Map()).get(doc)!

/** The open notes of a document. */
const pathsOf = (doc: string) => [...docs.keys()].filter((p) => sharedDocOfPath(p) === doc)

/** This device's results of a note that changed since sent — sent (a reader's are not: they stay here). */
async function send(path: string): Promise<void> {
  const sh = sharedOfPath(path)
  const n = loadedNoteRun(path)
  if (!sh || !n?.loaded || !online.value || readonlyPath(path)) return
  const was = sentOf(sh.doc)
  const delta = entriesToSend(was, runEntries(n))
  if (!Object.keys(delta).length) return
  // (plain data: the reactive results cannot cross to the main process)
  const plain = JSON.parse(JSON.stringify(delta)) as Record<string, unknown>
  await window.qa.sharedResultsPut(sh.space, sh.doc, plain)
  for (const [k, v] of Object.entries(plain)) {
    if (v === null) was.delete(k)
    else was.set(k, JSON.stringify(v))
  }
}
function sendSoon(path: string): void {
  clearTimeout(timers.get(path))
  timers.set(
    path,
    setTimeout(() => void send(path).catch((e: Error) => console.warn('run results:', e.message)), SEND_MS),
  )
}

/** The others' results since the last fetched: into each open note of the document (kept here too). */
async function fetchFor(doc: string): Promise<void> {
  const space = sharedInfo.get(doc)?.space
  const paths = pathsOf(doc)
  if (!space || !paths.length || !online.value) return
  const page = await window.qa.sharedResultsGet(space, doc, seqOf.get(doc) ?? 0)
  seqOf.set(doc, page.seq)
  for (const path of paths) {
    const n = noteRun(path)
    // (the note's own results file first: a newer own run is never replaced)
    for (let i = 0; i < 50 && !n.loaded; i++) await new Promise((r) => setTimeout(r, 20))
    let changed = false
    for (const [key, r] of Object.entries(page.entries)) {
      if (r.device === me.value) continue
      if (applyEntry(n, key, r.value, r.by)) {
        sentOf(doc).delete(key)
        changed = true
      }
    }
    if (changed) saveRunsSoon(path)
  }
}

let started = false
/** The results followed from the app's start. */
export function startSharedRunResults(): void {
  if (started) return
  started = true
  onRunsChanged((path) => sharedOfPath(path) && sendSoon(path))
  window.qa.onServer((ev) => {
    if (ev.e === 'doc.results' && ev.p.by !== me.value) void fetchFor(ev.p.doc).catch(() => undefined)
  })
  // a shared note in step with the server (opened, online again): what came meanwhile fetched, this device's sent
  watch(
    () => [...sharedInfo].filter(([, i]) => i.live).map(([d]) => d),
    (live, before) => {
      for (const doc of live)
        if (!before?.includes(doc))
          void fetchFor(doc)
            .then(() => pathsOf(doc).forEach(sendSoon))
            .catch(() => undefined)
    },
  )
}
