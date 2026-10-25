import type { ChatFile } from '@shared/transport/chat'
import { toWav16k } from './recorder'

/**
 * A chat's voice message as words: its sound fetched, made 16 kHz WAV, read by the local recognizer (Настройки →
 * Голос). Each message once per run (its file never changes); a failure — asked anew next time.
 */
const texts = new Map<string, Promise<string>>()
export function voiceTextOf(room: string, f: ChatFile): Promise<string> {
  let t = texts.get(f.id)
  if (!t) {
    t = (async () => {
      const bytes = await window.qa.chatFileGet(room, f.id)
      const wav = await toWav16k(new Blob([bytes as BlobPart], { type: f.mime || 'audio/webm' }))
      return (await window.qa.vaultTranscribe(wav, `chat-${f.id}`)).trim()
    })()
    t.catch(() => texts.delete(f.id))
    texts.set(f.id, t)
  }
  return t
}
