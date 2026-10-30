import { markRaw, reactive, toRaw } from 'vue'
import type { ValueSource } from '../domain/blockInfo'
import { jsonClone, type Values } from '../domain/values'
import { runApi } from './runApi'
import type { LoopRun, NoteRun } from './runTypes'

/**
 * The notes' runs in memory (reactive — the blocks show them as they go) and on disk (vault/.runs/<note>.json):
 * loaded with the note, saved a moment after a change, trimmed when a long loop makes them huge.
 */
const notes = reactive(new Map<string, NoteRun>())
/** Each note's runs file read (or found missing): resolved then. */
const loading = new Map<string, Promise<NoteRun>>()

/** A note's runs (made, and loaded from its runs file, on first use). */
export function noteRun(path: string): NoteRun {
  let n = notes.get(path)
  if (!n) {
    notes.set(path, { ctx: {}, runs: {}, loops: {}, loaded: false })
    const into = notes.get(path)!
    n = into
    loading.set(
      path,
      loadSavedRuns(path, into).then(() => into),
    )
  }
  return n
}
/** A note's runs once its runs file is in (what a run already wrote kept). */
export function loadedRuns(path: string): Promise<NoteRun> {
  noteRun(path)
  return loading.get(path)!
}
/** A note's runs if they are in memory already (nothing made or loaded). */
export const loadedNoteRun = (path: string): NoteRun | undefined => notes.get(path)
/** The runs file read into a note's runs: what was going on when the app closed failed; what a run already wrote wins. */
async function loadSavedRuns(path: string, into: NoteRun): Promise<void> {
  try {
    const json = await runApi().runLoad(path)
    if (!json) return
    const d = JSON.parse(json) as Partial<NoteRun>
    for (const r of Object.values(d.runs ?? {})) if (r.state === 'run') r.state = 'error'
    Object.values(d.loops ?? {}).forEach(markInterrupted)
    // (into the objects there are — a run already going on holds them; what it wrote wins)
    for (const [k, v] of Object.entries(d.ctx ?? {})) if (!(k in into.ctx)) into.ctx[k] = v
    for (const [k, v] of Object.entries(d.runs ?? {})) if (!(k in into.runs)) into.runs[k] = v
    for (const [k, v] of Object.entries(d.loops ?? {})) if (!(k in into.loops)) into.loops[k] = v
    if (d.sync) into.sync = { ...d.sync, ...into.sync }
  } catch {
    // no runs file, or a broken one: the note starts clean
  } finally {
    into.loaded = true
  }
}
/** A loop saved while it ran: it and its passes failed («Прервано»). */
function markInterrupted(l: LoopRun): void {
  if (l.state === 'run') (l.state = 'error'), (l.error ??= 'Прервано')
  for (const p of l.passes ?? []) {
    if (p.state === 'run') p.state = 'error'
    for (const r of Object.values(p.runs ?? {})) if (r.state === 'run') r.state = 'error'
    Object.values(p.loops ?? {}).forEach(markInterrupted)
  }
}

/**
 * The note's context as plain values (what templates, code and queries see). Read through Vue first: a computed
 * that asks for the values follows every value of the note (a block run again changes its time).
 */
export function noteValues(path: string): Values {
  const ctx = noteRun(path).ctx
  for (const k in ctx) void ctx[k].at
  // (the raw values: Vue's proxies cannot be sent to another process)
  return Object.fromEntries(Object.entries(toRaw(ctx)).map(([k, v]) => [k, toRaw(v).value]))
}
/** A value put into the note's context (a copy of it), the runs saved soon. */
export function publishToNote(path: string, name: string, value: unknown, from: ValueSource, block: string): void {
  noteRun(path).ctx[name] = { value: jsonClone(value), at: Date.now(), from, block }
  saveRunsSoon(path)
}
/**
 * A value gathered by emit() put into the note's context as it comes (runEmits gives a new one each time it is
 * shown — never cloned deep here, never watched deep: a long stream stays cheap); `partial` — its run did not end
 * well (stopped, failed): what came is kept.
 */
export function publishGathered(path: string, name: string, value: unknown, from: ValueSource, block: string, partial = false): void {
  noteRun(path).ctx[name] = { value: value && typeof value === 'object' ? markRaw(value) : value, at: Date.now(), from, block, ...(partial ? { partial } : {}) }
  saveRunsSoon(path)
}
/**
 * A variable of the note cleared (the «Значение» block's eraser): it is gone until a block publishes it again; one
 * gathered with keep=N starts its history anew. A data block's value comes back at once — it is the note's text.
 */
export function clearValue(path: string, name: string): void {
  const ctx = noteRun(path).ctx
  if (!(name in ctx)) return
  delete ctx[name]
  saveRunsSoon(path)
}
/** A block's results moved to another key (it got an id of its own: they stay with it). */
export function moveRun(path: string, from: string, to: string): void {
  const n = noteRun(path)
  for (const o of [n.runs, n.loops] as Array<Record<string, unknown>>)
    if (from in o && !(to in o)) {
      o[to] = o[from]
      delete o[from]
    }
  saveRunsSoon(path)
}
/** The note's context and runs emptied (in place: a run going on writes into these very objects). */
export function clearNoteRuns(path: string): void {
  const n = noteRun(path)
  for (const o of [n.ctx, n.runs, n.loops] as Array<Record<string, unknown>>) for (const k of Object.keys(o)) delete o[k]
  saveRunsSoon(path)
}

// ---------- saving ----------
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** The runs file's budget: past it, the old passes of long loops let their blocks' runs go. */
const RUNS_BUDGET = 12 * 1024 * 1024
/** How many of a loop's last passes keep their blocks' runs when the file is over its budget. */
const PASSES_KEPT = 50

/** Who wants to know a note's runs changed (a shared note's — sent to the others). */
const changeListeners: Array<(path: string) => void> = []
export const onRunsChanged = (fn: (path: string) => void) => void changeListeners.push(fn)

/** The note's runs saved in a moment (800 ms; 4 s while a loop runs — its passes come fast); told to whoever listens. */
export function saveRunsSoon(path: string): void {
  for (const fn of changeListeners) fn(path)
  // (a stream of changes — emit() batches — never puts the save off for ever: past SAVE_MAX_WAIT since the first change
  // not saved, the save already set stays as it is)
  const since = unsavedSince.get(path)
  if (since !== undefined && saveTimers.has(path) && Date.now() - since > SAVE_MAX_WAIT) return
  if (!saveTimers.has(path)) unsavedSince.set(path, Date.now())
  clearTimeout(saveTimers.get(path))
  const busy = Object.values(notes.get(path)?.loops ?? {}).some((l) => l.state === 'run')
  saveTimers.set(
    path,
    setTimeout(() => void writeRuns(path), busy ? 4000 : 800),
  )
}
/** The first change of a note not saved yet (ms) — the save is not put off past SAVE_MAX_WAIT after it. */
const unsavedSince = new Map<string, number>()
const SAVE_MAX_WAIT = 1000
/** The runs not saved yet — saved now (before a document is packed). */
export async function flushRuns(): Promise<void> {
  const paths = [...saveTimers.keys()]
  for (const p of paths) clearTimeout(saveTimers.get(p))
  await Promise.all(paths.map(writeRuns))
}
function writeRuns(path: string): Promise<void> {
  saveTimers.delete(path)
  unsavedSince.delete(path)
  const n = noteRun(path)
  let json: string
  try {
    json = JSON.stringify({ ctx: n.ctx, runs: n.runs, loops: n.loops, sync: n.sync })
    if (json.length > RUNS_BUDGET) {
      for (const l of Object.values(n.loops)) trimLoop(l, PASSES_KEPT)
      json = JSON.stringify({ ctx: n.ctx, runs: n.runs, loops: n.loops, sync: n.sync })
    }
  } catch {
    return Promise.resolve()
  }
  return runApi()
    .runSave(path, json)
    .catch(() => undefined)
}
/** A loop's passes but the last `keep` (and the one shown): their blocks' runs dropped, their values kept. */
function trimLoop(l: LoopRun, keep: number): void {
  const sel = l.sel ?? l.passes.length - 1
  l.passes.forEach((p, i) => {
    if (i >= l.passes.length - keep || i === sel || !p.runs) return
    p.runs = undefined
    p.loops = undefined
    l.trimmed = (l.trimmed ?? 0) + 1
  })
}

// ---------- notes renamed / deleted ----------
const isUnder = (path: string, p: string) => p === path || p.startsWith(`${path}/`)
/**
 * A note (or a folder) deleted: its runs forgotten here too — a pending save of them dropped (it would write them back
 * after the delete), so a new note of the same name starts clean.
 */
export function forgetRuns(path: string): void {
  for (const p of [...notes.keys()])
    if (isUnder(path, p)) {
      notes.delete(p)
      loading.delete(p)
    }
  for (const p of [...saveTimers.keys()])
    if (isUnder(path, p)) {
      clearTimeout(saveTimers.get(p))
      saveTimers.delete(p)
      unsavedSince.delete(p)
    }
}
/** A note (or a folder) renamed / moved: its runs go with it (on the disk they are moved by the vault). */
export function moveRuns(from: string, to: string): void {
  for (const p of [...notes.keys()])
    if (isUnder(from, p)) {
      notes.set(to + p.slice(from.length), notes.get(p)!)
      loading.set(to + p.slice(from.length), loading.get(p)!)
      notes.delete(p)
      loading.delete(p)
    }
  for (const p of [...saveTimers.keys()])
    if (isUnder(from, p)) {
      clearTimeout(saveTimers.get(p))
      saveTimers.delete(p)
      unsavedSince.delete(p)
      saveRunsSoon(to + p.slice(from.length))
    }
}
