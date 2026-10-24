import { CHAT_FILE_MAX, fileKindOf, type ChatFile } from '@shared/transport/chat'
import { sendAttach } from './chatActions'

/**
 * The chats' files in the window: a picture's address to show it (fetched once per run — the app keeps the file
 * too), files sent (each its own message, the words with the first), a file saved where one picks.
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
/** A pasted picture has no name of its own: one by its type. */
const nameOf = (f: File) => f.name || `изображение.${f.type.split('/')[1] ?? 'png'}`

/** A file sent into a room as a message of its own (a picture — shown right in the chat, any other — a file to save). */
export async function sendFile(room: string, f: File, text: string): Promise<void> {
  const file = await window.qa.chatFilePut(room, nameOf(f), f.type, new Uint8Array(await f.arrayBuffer()))
  await sendAttach(room, { kind: fileKindOf(file.mime), title: file.name, data: file }, text)
}
/** A file's size in words. */
export function sizeText(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}
