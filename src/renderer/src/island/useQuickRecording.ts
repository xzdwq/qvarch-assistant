import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { Ms, PublicSettings } from '@shared/types'
import { AUDIO_NOTE_LOOK, type AudioNoteKind } from '@shared/tracker/constants'
import { startRecording, transcribeNote, type Recording } from '../lib/recorder'

/** Recording seconds as m:ss. */
export const fmtRec = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/**
 * A recording from the orb panel — a voice note (it joins the open note) or the call. It goes on even with the
 * panel closed; stopping saves it as an audio note and, when switched on, transcribes it locally.
 */
export function useQuickRecording(o: {
  today: Ref<string>
  settings: ShallowRef<PublicSettings | undefined>
  note: Ref<{ id: string; text: string } | undefined>
  qMsg: Ref<string>
  noteHasAudio: Ref<boolean>
}) {
  const { today, settings, note, qMsg, noteHasAudio } = o
  const recording = shallowRef<{ kind: AudioNoteKind; rec: Recording; at: Ms; id: string }>()
  const recLevel = ref(0)
  const recSec = ref(0)
  let recTimer: ReturnType<typeof setInterval> | undefined

  async function startRec(kind: AudioNoteKind): Promise<void> {
    if (recording.value) return
    qMsg.value = ''
    try {
      const rec = await startRecording(kind)
      recording.value = { kind, rec, at: Date.now(), id: kind === 'voice' && note.value ? note.value.id : crypto.randomUUID() }
      recSec.value = 0
      recTimer = setInterval(() => {
        recLevel.value = recording.value?.rec.level() ?? 0
        recSec.value = recording.value ? (Date.now() - recording.value.at) / 1000 : 0
      }, 120)
    } catch (e) {
      qMsg.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function stopRec(): Promise<void> {
    const r = recording.value
    if (!r) return
    recording.value = undefined
    clearInterval(recTimer)
    const { blob, durationSec } = await r.rec.stop()
    if (durationSec < 1) {
      qMsg.value = 'Слишком короткая запись'
      return
    }
    const text = r.kind === 'voice' ? (note.value?.text ?? '') : ''
    const saved = await window.qa.saveAudioNote(today.value, { id: r.id, at: r.at, durationSec, kind: r.kind, text }, new Uint8Array(await blob.arrayBuffer()))
    if (r.kind === 'voice' && note.value?.id === r.id) noteHasAudio.value = true
    qMsg.value = `${AUDIO_NOTE_LOOK[r.kind].label} сохранена`
    if (settings.value?.voice.enabled && settings.value?.voice.autoTranscribe && saved.audio) {
      const vs = await window.qa.voiceState()
      if (vs.modelReady) {
        qMsg.value += ' · расшифровка…'
        transcribeNote(today.value, saved.id, saved.audio.file)
          .then(() => (qMsg.value = qMsg.value.replace(' · расшифровка…', ' · расшифровано')))
          .catch((e: Error) => (qMsg.value = e.message))
      }
    }
  }

  return { recording, recLevel, recSec, startRec, stopRec, fmtRec }
}
