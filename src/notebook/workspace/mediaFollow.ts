import { mediaWaitsOf, type MediaReport, type MediaWait } from '@shared/transport/space'

/**
 * The notes' pictures and recordings as the page shows them — the one way to show one: followed until it is here.
 * The disk is the source of truth: the main process tells every media file that appears in the vault (fetched for a
 * shared note, pasted, put back by an undo, put there outside) — whoever follows it shows it then. While a shared
 * note's file is not here, where it stands (on its way, waiting for the connection, for the one who added it, failed)
 * is told as the note's sync learns it. No timers, no polling: events, and a sync at each connection.
 */

// ---------- addresses (read once per run; the only reads of the media for showing) ----------
const urls = { image: new Map<string, Promise<string>>(), audio: new Map<string, Promise<string>>() }
const READS: Record<keyof typeof urls, (rel: string) => Promise<string>> = {
  image: (rel) => window.qa.vaultReadImage(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart]))),
  audio: (rel) => window.qa.vaultReadAudio(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'audio/webm' }))),
}
function urlOf(kind: keyof typeof urls, rel: string): Promise<string> {
  let u = urls[kind].get(rel)
  if (!u) {
    u = READS[kind](rel)
    u.catch(() => urls[kind].delete(rel))
    urls[kind].set(rel, u)
  }
  return u
}
/** A picture's address made again next time (its file was put back: an undo). */
export const forgetImage = (rel: string) => void urls.image.delete(rel)

// ---------- a file's coming ----------
const arrivals = new Map<string, Set<() => void>>()
function onArrival(rel: string, fn: () => void): () => void {
  const set = arrivals.get(rel) ?? arrivals.set(rel, new Set()).get(rel)!
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size) arrivals.delete(rel)
  }
}
window.qa.onVaultMedia((rels) => {
  for (const rel of rels) {
    setWait(rel, null)
    for (const fn of [...(arrivals.get(rel) ?? [])]) fn()
  }
})

// ---------- where a shared note's file stands while it is not here ----------
const waits = new Map<string, MediaWait>()
const waitSeen = new Map<string, Set<(w: MediaWait | undefined) => void>>()
function setWait(rel: string, w: MediaWait | null): void {
  if (!w && !waits.has(rel)) return
  if (w) waits.set(rel, w)
  else waits.delete(rel)
  for (const fn of waitSeen.get(rel) ?? []) fn(w ?? undefined)
}
function watchWait(rel: string, fn: (w: MediaWait | undefined) => void): () => void {
  const set = waitSeen.get(rel) ?? waitSeen.set(rel, new Set()).get(rel)!
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size) waitSeen.delete(rel)
  }
}
/**
 * A shared note's text names these files (a change came, it was opened): each one not known yet — on its way (online)
 * or waiting for the connection; told before anything tries to show it (no «not found» for a moment).
 */
export function mediaExpected(rels: readonly string[], online: boolean): void {
  for (const rel of rels) if (!waits.has(rel)) setWait(rel, { state: online ? 'loading' : 'offline' })
}
/** These files are being asked from the server now: the ones waiting — on their way. */
export function mediaAsked(rels: readonly string[]): void {
  for (const rel of rels) if (waits.has(rel)) setWait(rel, { state: 'loading' })
}
/** A sync of a shared note's files done: each asked file — where it stands now (here — no wait; its coming — an event). */
export function mediaReported(r: MediaReport, asked: readonly string[]): void {
  for (const [rel, w] of Object.entries(mediaWaitsOf(r, asked))) if (!r.fetched.includes(rel)) setWait(rel, w)
}

// ---------- following ----------
/** What a media file's follower is told: its address once it is here; while it is not — where it stands (none known — undefined). */
export interface MediaWatch {
  shown: (url: string) => void
  missing: (wait: MediaWait | undefined) => void
}
/**
 * A media file shown as soon as it is here: now, or the moment it appears (waited for from before it is read — nothing
 * slips between); while not — where it stands, as it changes. The stop returned (the view gone).
 */
function follow(kind: keyof typeof urls, rel: string, w: MediaWatch): () => void {
  let stopped = false
  let missing = false
  let unwatch = () => {}
  const look = (): void => {
    urlOf(kind, rel).then(
      (u) => {
        if (stopped) return
        stop()
        w.shown(u)
      },
      () => {
        if (stopped || missing) return
        missing = true
        w.missing(waits.get(rel))
        unwatch = watchWait(rel, w.missing)
      },
    )
  }
  const unarrive = onArrival(rel, look)
  const stop = () => {
    stopped = true
    unarrive()
    unwatch()
  }
  look()
  return stop
}
/** A picture shown as soon as it is here (a note's, a board's). */
export const followImage = (rel: string, w: MediaWatch): (() => void) => follow('image', rel, w)
/** A recording ready to play as soon as it is here. */
export const followAudio = (rel: string, w: MediaWatch): (() => void) => follow('audio', rel, w)
