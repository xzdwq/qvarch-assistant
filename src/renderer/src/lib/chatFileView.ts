import { BUNDLE_EXT } from '@shared/docBundle'
import { CHAT_FILE_MAX, type ChatFile } from '@shared/transport/chat'

/**
 * The chats' files as any window shows them (the app's main process keeps them — no chat state needed): a picture's
 * address, a file saved where one picks, its size in words, whether a file may go.
 */

/** Each file's address (by its id: a file of a chat never changes). */
const urls = new Map<string, Promise<string>>()
export function chatFileUrl(room: string, f: ChatFile): Promise<string> {
  let u = urls.get(f.id)
  if (!u) {
    u = window.qa.chatFileGet(room, f.id).then((b) => URL.createObjectURL(new Blob([b as BlobPart], { type: f.mime })))
    u.catch(() => urls.delete(f.id))
    urls.set(f.id, u)
  }
  return u
}
export const saveChatFile = (room: string, f: ChatFile) => window.qa.chatFileSave(room, f.id, f.name)

/** Why a file cannot go (none — it can). */
export const fileRefusal = (f: File): string | undefined => (f.size > CHAT_FILE_MAX ? `«${f.name}» больше ${CHAT_FILE_MAX / 1024 / 1024} МБ` : undefined)
/** A file that is a note / a folder of a notebook (it goes into this one in a click). */
export const isNotesFile = (f: ChatFile) => f.name.toLowerCase().endsWith(`.${BUNDLE_EXT}`)
/** A file's size in words. */
export function sizeText(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}
