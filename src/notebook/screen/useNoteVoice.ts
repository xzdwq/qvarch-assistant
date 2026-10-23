import { nextTick, ref, type ComputedRef } from 'vue'
import { audioEmbed } from '@shared/vault'
import { isBoard } from '@shared/whiteboard'
import { useRecorder } from '@renderer/lib/recorder'
import { remoteError } from '../../shared/remoteError'
import { doc, setText } from '@nb/workspace/noteDocs'
import { curPane, layout, openFile, type Pane } from '@nb/workspace/paneLayout'
import { putTranscript } from '@nb/workspace/noteSync'
import { transcribe, transcribeError, TranscribeCancelled } from '@nb/workspace/transcription'
import { loadTree } from '@nb/workspace/vaultTreeStore'
import type { NoteEditors } from './noteEditors'

/** Voice into the open note (its place shown in the text while recording), or a note of its own; transcribed after. */
export function useNoteVoice(say: (t: string) => void, editors: NoteEditors, targetDir: ComputedRef<string>) {
  const recorder = useRecorder()
  /** Recording into a note; `inline` — its place is shown in the text (no bar above). */
  const recInto = ref<{ path: string; pane: string; inline?: boolean }>()

  async function startRec(p: Pane): Promise<void> {
    if (!p.active) return
    if (recorder.rec.value) return void stopRec()
    if (await recorder.start('voice')) {
      const ed = isBoard(p.active) ? undefined : editors.of(p)
      ed?.startRecMarker()
      recInto.value = { path: p.active, pane: p.id, inline: !!ed }
    } else say(recorder.error.value)
  }
  /** The recording saved and put where it was made (the marker's place, else the end of the note). */
  async function stopRec(): Promise<void> {
    const into = recInto.value
    recInto.value = undefined
    const r = await recorder.stop()
    if (!into) return
    const pane = layout.panes.find((x) => x.id === into.pane)
    const ed = pane?.active === into.path ? editors.of(pane) : undefined
    // the place shown while recording
    const at = ed?.takeRecMarker() ?? null
    if (!r) return say('Слишком короткая запись')
    try {
      const rel = await window.qa.vaultSaveAudio(new Uint8Array(await r.blob.arrayBuffer()))
      if (ed && at !== null) ed.insertAudioAt(at, audioEmbed(rel))
      else if (ed) ed.insertBlock(audioEmbed(rel))
      else {
        const d = doc(into.path)
        setText(into.path, `${d.text.replace(/\s*$/, '')}\n\n${audioEmbed(rel)}\n`)
      }
      const s = await window.qa.getSettings()
      if (s.voice.enabled && s.voice.autoTranscribe && (await window.qa.voiceState()).modelReady) void transcribeInto(into.path, rel)
    } catch (e) {
      say(remoteError(e))
    }
  }
  async function transcribeInto(path: string, rel: string): Promise<void> {
    try {
      putTranscript(path, rel, await transcribe(rel))
    } catch (e) {
      // the recording was deleted meanwhile: nothing to say
      if (e instanceof TranscribeCancelled) return
      say(transcribeError.value || 'Не удалось расшифровать')
    }
  }
  /** A note of its own («Голосовая <date>»), recording into it at once. */
  async function newVoiceNote(): Promise<void> {
    const now = new Date()
    const stamp = `${now.toLocaleDateString('ru-RU')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
    try {
      const path = await window.qa.vaultCreate(targetDir.value, 'note', `Голосовая ${stamp}`, `# Голосовая заметка\n\n`)
      await loadTree()
      openFile(path)
      await nextTick()
      await startRec(curPane())
    } catch (e) {
      say(remoteError(e))
    }
  }
  return { recorder, recInto, startRec, stopRec, transcribeInto, newVoiceNote }
}
