import { clockSec, fileKindOf, VOICE_MAX_SEC, type ChatFile, type ChatReply } from '@shared/transport/chat'
import { sendAttach } from './chatActions'
import { isHeld } from './chat'

/**
 * The chats' files sent from the main window (each its own message, the words with the first): a file, a voice
 * message, a note / a folder of the notebook; one received put into the notebook. Showing them — chatFileView.
 */

/** A pasted picture has no name of its own: one by its type. */
const nameOf = (f: File) => f.name || `изображение.${f.type.split('/')[1] ?? 'png'}`

/** A file sent into a room as a message of its own (a picture — shown right in the chat, any other — a file to save). */
export async function sendFile(room: string, f: File, text: string, reply?: ChatReply): Promise<void> {
  const file = await window.qa.chatFilePut(room, nameOf(f), f.type, new Uint8Array(await f.arrayBuffer()))
  await sendAttach(room, { kind: fileKindOf(file.mime), title: file.name, data: file }, text, reply)
}
/** A voice message recorded here sent into a room (a file of the room, played right in the chat). */
export async function sendVoice(room: string, blob: Blob, sec: number, reply?: ChatReply, text = ''): Promise<void> {
  if (isHeld(room)) throw new Error('Голосовые отправляются через сервер — этот чат пока только на этом компьютере')
  const length = Math.min(Math.round(sec), VOICE_MAX_SEC)
  const file = await window.qa.chatFilePut(room, `Голосовое ${new Date().toLocaleString('ru-RU').replace(/[/:]/g, '-')}.webm`, 'audio/webm', new Uint8Array(await blob.arrayBuffer()))
  await sendAttach(room, { kind: 'voice', title: `Голосовое ${clockSec(length)}`, data: { ...file, sec: length } }, text, reply)
}
/** A note / a folder of the notebook sent into a room as one file (its export: the one who gets it puts it into their notebook). */
export async function sendNotes(room: string, rel: string, withRuns: boolean, text: string): Promise<void> {
  const file = await window.qa.chatFileFromNotes(room, rel, withRuns)
  await sendAttach(room, { kind: 'file', title: file.name, data: file }, text)
}
/** A received note / folder put into the notebook (its top): what was made. */
export const notesToNotebook = (room: string, f: ChatFile) => window.qa.chatFileToNotes(room, f.id, '')
