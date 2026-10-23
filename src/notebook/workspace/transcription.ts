import { reactive, ref } from 'vue'
import { toWav16k } from '@renderer/lib/recorder'
import { remoteError } from '../../shared/remoteError'

/** Voice recordings of the notes transcribed (locally, by whisper): their state, a stop when a recording is gone. */

/** The transcription of a recording in progress: path of the audio → state. */
export const transcribing = reactive(new Map<string, 'run' | 'error'>())
export const transcribeError = ref('')
/** Recordings deleted while their transcription ran: the text that still comes is thrown away. */
const stopped = new Set<string>()
/** A recording is gone: its transcription stops (the whisper process is killed). */
export function cancelTranscribe(audio: string): void {
  if (transcribing.get(audio) !== 'run') return
  stopped.add(audio)
  transcribing.delete(audio)
  window.qa.vaultTranscribeCancel(audio)
}
export class TranscribeCancelled extends Error {}
/** A recording's text (TranscribeCancelled — the recording was deleted meanwhile). */
export async function transcribe(audio: string): Promise<string> {
  stopped.delete(audio)
  transcribing.set(audio, 'run')
  transcribeError.value = ''
  try {
    const bytes = await window.qa.vaultReadAudio(audio)
    const wav = await toWav16k(new Blob([bytes as BlobPart], { type: 'audio/webm' }))
    if (stopped.has(audio)) throw new TranscribeCancelled()
    const text = await window.qa.vaultTranscribe(wav, audio)
    if (stopped.has(audio)) throw new TranscribeCancelled()
    transcribing.delete(audio)
    return text
  } catch (e) {
    if (e instanceof TranscribeCancelled || stopped.has(audio)) {
      stopped.delete(audio)
      transcribing.delete(audio)
      throw new TranscribeCancelled()
    }
    transcribing.set(audio, 'error')
    transcribeError.value = remoteError(e)
    throw e
  }
}
