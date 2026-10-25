import { audiosOf, imagesOf } from '@shared/vault'
import { remoteError } from '../../shared/remoteError'
import { forgetImage } from './mediaFollow'
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
  onBack: forgetImage,
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
