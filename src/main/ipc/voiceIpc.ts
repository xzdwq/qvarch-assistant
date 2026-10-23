import { isWhisperModel, titleFromTranscript, VOICE_PENDING } from '../../shared/voice'
import type { Note } from '../../shared/types'
import type { AppContext } from '../app/appContext'
import { handle } from './router'

/** Voice notes and call recordings: the speech models, a recording made a note, its transcript. */
export function registerVoiceIpc(app: AppContext): void {
  const { store, voice } = app
  const knownModel = (id: string) => {
    if (!isWhisperModel(id)) throw new Error('Неизвестная модель')
    return id
  }
  handle('voiceState', () => voice.state())
  handle('voiceDownloadModel', (_e, id) => voice.downloadModel(knownModel(id)))
  handle('voiceDeleteModel', (_e, id) => voice.deleteModel(knownModel(id)))
  handle('readAudio', (_e, file) => voice.readAudio(String(file)))
  handle('saveAudioNote', (_e, day, input, audio) => {
    const d = store.day(day)
    const file = voice.saveAudio(day, input.id, audio)
    const note: Note = {
      id: input.id,
      at: input.at,
      text: input.text ?? '',
      updatedAt: Date.now(),
      audio: { file, durationSec: Math.round(input.durationSec), kind: input.kind },
      ...(input.entryId ? { entryId: input.entryId } : {}),
    }
    d.notes = [...d.notes.filter((n) => n.id !== note.id), note]
    store.markDirty(day)
    store.flush()
    app.broadcast()
    return note
  })
  handle('transcribeNote', async (_e, day, noteId, wav) => {
    if (!store.cfg.voice.enabled) throw new Error('Расшифровка выключена в настройках')
    const text = await voice.transcribe(noteId, wav)
    const d = store.day(day)
    // the note may have been deleted meanwhile — then there is nothing to update
    const n = d.notes.find((x) => x.id === noteId)
    if (n) {
      n.transcript = text
      n.updatedAt = Date.now()
      // dictated for a block: the transcript becomes the block's text (unless the user already wrote one)
      const e = n.entryId ? d.entries.find((x) => x.id === n.entryId) : undefined
      if (e && text && e.label === VOICE_PENDING) {
        const t = titleFromTranscript(text)
        e.label = t.label
        e.description = e.description ?? t.description
      }
      store.markDirty(day)
      store.flush()
      app.broadcast()
    }
    return text
  })
}
