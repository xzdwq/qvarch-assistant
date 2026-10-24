import { audiosOf, imagesOf } from '@shared/vault'
import type { MediaReport } from '@shared/transport/space'
import { remoteError } from '../../shared/remoteError'
import { cancelTranscribe } from './transcription'

/**
 * The notes' recordings and pictures as the page has them: addresses to show / play them (made once per run), what
 * a drop / a paste brings in, and their files following the texts — a line removed deletes the file (if nothing else
 * has it), an undo that brings the line back puts the file back (its bytes are kept for the session).
 */

/** Media gone from the texts, a kind each: how its file is read, deleted, put back. */
interface MediaKind {
  of: (text: string) => string[]
  read: (rel: string) => Promise<Uint8Array>
  remove: (rel: string) => Promise<boolean>
  restore: (rel: string, bytes: Uint8Array) => Promise<unknown>
  /** A file deleted: its transcription stops. */
  onGone?: (rel: string) => void
  /** A file back: its address made again. */
  onBack?: (rel: string) => void
}
/** The bytes of the files deleted this session (an undo brings them back). */
const removed = new Map<string, Uint8Array>()

async function syncMedia(kind: MediaKind, before: string, after: string): Promise<void> {
  const was = new Set(kind.of(before))
  const now = new Set(kind.of(after))
  for (const rel of now)
    if (!was.has(rel) && removed.has(rel)) {
      await kind.restore(rel, removed.get(rel)!)
      removed.delete(rel)
      kind.onBack?.(rel)
    }
  for (const rel of was) {
    if (now.has(rel)) continue
    kind.onGone?.(rel)
    try {
      const bytes = await kind.read(rel)
      if (await kind.remove(rel)) removed.set(rel, bytes)
    } catch {
      // already gone
    }
  }
}

/** A picture of the vault as an address the page can show (made once per run). */
const imageUrls = new Map<string, Promise<string>>()
/** Who waits for a media file not on this computer yet (a shared note's — it comes from the server). */
const waiting = new Map<string, Set<() => void>>()
/** The files that came this run (one who starts waiting a moment too late is not left waiting). */
const arrived = new Set<string>()
/** A media file that is missing now has come: `fn` then (come already — at once); the unsubscribe returned. */
function onMediaArrives(rel: string, fn: () => void): () => void {
  if (arrived.has(rel)) {
    fn()
    return () => undefined
  }
  const set = waiting.get(rel) ?? waiting.set(rel, new Set()).get(rel)!
  set.add(fn)
  return () => set.delete(fn)
}
/** A media file that is missing now has come: resolves then (come already — at once). */
export const whenMediaArrives = (rel: string): Promise<void> => new Promise((ok) => void onMediaArrives(rel, ok))
/** Media files written to this computer (fetched for a shared note): whoever waits for them shows them. */
export function mediaArrived(rels: readonly string[]): void {
  for (const rel of rels) {
    arrived.add(rel)
    problems.delete(rel)
    const fns = [...(waiting.get(rel) ?? [])]
    waiting.delete(rel)
    for (const fn of fns) fn()
  }
}

/** A picture not here: looked at again this often, this many times (while it is followed). */
const LOOK_AGAIN_MS = 5000
const LOOK_AGAIN_TIMES = 60
/** What a picture's follower is told: its address once it is here; while it is not — why (as far as known). */
export interface ImageWatch {
  shown: (url: string) => void
  missing: (why: string) => void
}
/**
 * A picture shown as soon as it is here: now, or when it comes — told of its coming (a shared note's file fetched)
 * and looked at again now and then (a file written meanwhile is never missed). The stop returned (the view gone).
 */
export function followImage(rel: string, w: ImageWatch): () => void {
  let stopped = false
  let failed = false
  let tries = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let unwatch = () => {}
  let unwait = () => {}
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    unwatch()
    unwait()
  }
  const look = (): void => {
    if (stopped) return
    imageUrl(rel).then(
      (u) => {
        if (stopped) return
        if (failed) window.qa.sharedLog(`image shown at last ${rel}`)
        stop()
        w.shown(u)
      },
      (e: Error) => {
        if (stopped) return
        if (!failed) {
          failed = true
          window.qa.sharedLog(`image missing ${rel}: ${e.message}`)
          w.missing('')
          unwatch = watchMediaProblem(rel, w.missing)
          unwait = onMediaArrives(rel, look)
        }
        clearTimeout(timer)
        if (++tries <= LOOK_AGAIN_TIMES) timer = setTimeout(look, LOOK_AGAIN_MS)
      },
    )
  }
  look()
  return stop
}
/** Why a shared note's file is not here (as the last sync said), and who shows it. */
const problems = new Map<string, string>()
const problemSeen = new Map<string, Set<(why: string) => void>>()
/** A sync of a shared note's files done: the fetched shown, the reasons of the others told. */
export function mediaReported(r: MediaReport): void {
  mediaArrived(r.fetched)
  for (const [rel, why] of Object.entries(r.problems)) {
    problems.set(rel, why)
    for (const fn of problemSeen.get(rel) ?? []) fn(why)
  }
}
/** Why a file is not here — now and whenever it is told again (the unsubscribe returned). */
export function watchMediaProblem(rel: string, fn: (why: string) => void): () => void {
  const now = problems.get(rel)
  if (now) fn(now)
  const set = problemSeen.get(rel) ?? problemSeen.set(rel, new Set()).get(rel)!
  set.add(fn)
  return () => set.delete(fn)
}
export function imageUrl(rel: string): Promise<string> {
  let u = imageUrls.get(rel)
  if (!u) {
    u = window.qa.vaultReadImage(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart])))
    u.catch(() => imageUrls.delete(rel))
    imageUrls.set(rel, u)
  }
  return u
}
/** Blob URLs of the recordings (read once). */
const audioUrls = new Map<string, Promise<string>>()
export function audioUrl(rel: string): Promise<string> {
  let u = audioUrls.get(rel)
  if (!u) {
    u = window.qa.vaultReadAudio(rel).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'audio/webm' })))
    u.catch(() => audioUrls.delete(rel))
    audioUrls.set(rel, u)
  }
  return u
}

const AUDIO: MediaKind = {
  of: audiosOf,
  read: (rel) => window.qa.vaultReadAudio(rel),
  remove: (rel) => window.qa.vaultDeleteAudio(rel),
  restore: (rel, bytes) => window.qa.vaultRestoreAudio(rel, bytes),
  onGone: cancelTranscribe,
}
const IMAGES: MediaKind = {
  of: imagesOf,
  read: (rel) => window.qa.vaultReadImage(rel),
  remove: (rel) => window.qa.vaultDeleteImage(rel),
  restore: (rel, bytes) => window.qa.vaultRestoreImage(rel, bytes),
  onBack: (rel) => imageUrls.delete(rel),
}
/** A text saved: the recordings and pictures it lost are deleted, the ones it got back are put back. */
export function syncMediaFiles(before: string, after: string): void {
  void syncMedia(AUDIO, before, after)
  void syncMedia(IMAGES, before, after)
}

const IMAGE_FILE = /^image\/(png|jpeg|gif|webp|bmp)$/
/**
 * Pictures from a drop / a paste / a file picker → the vault: their paths (each picture that could not be
 * taken is reported, the rest still go in). Files first; else an image's address (dragged from a web page).
 */
export async function takeImages(dt: { files?: FileList | File[] | null; uri?: string }, warn: (msg: string) => void): Promise<string[]> {
  const out: string[] = []
  const files = [...(dt.files ?? [])].filter((f) => IMAGE_FILE.test(f.type))
  for (const f of files) {
    try {
      out.push(await window.qa.vaultSaveImage(new Uint8Array(await f.arrayBuffer())))
    } catch (e) {
      warn(`«${f.name}»: ${remoteError(e)}`)
    }
  }
  if (!files.length && dt.uri) {
    try {
      out.push(await window.qa.vaultFetchImage(dt.uri))
    } catch (e) {
      warn(remoteError(e))
    }
  }
  return out
}
/** Does a drag / a paste carry pictures (files, or an image dragged from a page)? */
export function hasImages(dt: DataTransfer | null): boolean {
  if (!dt) return false
  if ([...dt.items].some((i) => i.kind === 'file' && IMAGE_FILE.test(i.type))) return true
  return [...dt.files].some((f) => IMAGE_FILE.test(f.type))
}
/** An image's address in a drag from a web page (none — undefined). */
export function draggedImageUrl(dt: DataTransfer | null): string | undefined {
  if (!dt) return undefined
  const html = dt.getData('text/html')
  const m = /<img[^>]+src="([^"]+)"/i.exec(html)
  const src = m?.[1]?.replace(/&amp;/g, '&')
  if (src && (/^https?:\/\//i.test(src) || src.startsWith('data:image/'))) return src
  return undefined
}
