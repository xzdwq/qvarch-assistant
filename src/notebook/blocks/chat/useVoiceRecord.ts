import { onBeforeUnmount, ref } from 'vue'
import { VOICE_MAX_SEC } from '@shared/transport/chat'
import { remoteError } from '@shared/remoteError'
import { startRecording, type Recording } from '@renderer/lib/recorder'

/**
 * A voice message being recorded in a chat's input: started, its seconds and level shown, sent (`send` gets the
 * sound) or dropped; at its longest — sent by itself. Leaving the chat drops it.
 */
export function useVoiceRecord(send: (blob: Blob, sec: number) => Promise<void>) {
  const recording = ref(false)
  const sec = ref(0)
  const level = ref(0)
  const error = ref('')
  let rec: Recording | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let started = 0

  function stopTimer(): void {
    clearInterval(timer)
    timer = undefined
    recording.value = false
    level.value = 0
  }
  async function start(): Promise<void> {
    if (recording.value) return
    error.value = ''
    try {
      rec = await startRecording('voice')
    } catch (e) {
      error.value = `Микрофон недоступен: ${remoteError(e)}`
      return
    }
    started = performance.now()
    sec.value = 0
    recording.value = true
    timer = setInterval(() => {
      sec.value = (performance.now() - started) / 1000
      level.value = rec?.level() ?? 0
      if (sec.value >= VOICE_MAX_SEC) void finish()
    }, 100)
  }
  /** Recorded: sent. */
  async function finish(): Promise<void> {
    const r = rec
    if (!r || !recording.value) return
    rec = undefined
    stopTimer()
    const { blob, durationSec } = await r.stop()
    // (a press too short to say anything — nothing sent)
    if (durationSec < 0.7) return
    try {
      await send(blob, durationSec)
    } catch (e) {
      error.value = remoteError(e)
    }
  }
  function cancel(): void {
    rec?.cancel()
    rec = undefined
    stopTimer()
  }
  onBeforeUnmount(cancel)
  return { recording, sec, level, error, start, finish, cancel }
}
